"""Generate the Process Definition Document (.docx) from a normalized session.

The PDD is the process manager's hand-over: a document the team can pass on
as it is, in place of the maps and documents built by hand. Its wording is
tool-neutral (any automation technology or application work), and it reads
in the reader's order:

  1. Document control: the process, the project folder (a developer's way
     into the recording), who recorded it, the transactions, whether a video
     is attached, and the request when the capture app set one (AD-30): its
     name and its code, "Invoice intake review (REQ-2026-042)". Its version
     (contract C20): "Version 2, handed off 2026-09-25 by rasha" when it is
     made for a hand-off, else "Working copy after version 2" (or "Working
     copy, not handed off yet"), then the version history table when the
     project was handed off (handoff_versions).
  2. Purpose and scope: the analyst's document fields (annotations.document,
     contract C6): purpose, scope, trigger, result and key contacts.
  3. As-Is process: the systems the process runs through, the As-Is map on
     a page of its own, and the steps of the reference transaction (the
     pattern run, contract C3). Each step says its system and screen, its
     average time, in how many transactions it happened and where it is in
     the recording ("Transaction 1 at 0:19", and the video time when the
     video's start is known); its description (C7) is its text. The flow
     the analyst set on it (C17) prints under it: "Only when" its condition,
     and where the process goes after it besides the next step. A step's
     heading reads "Step 2: <name>", so a step's number never reads as a
     section's (lane FX1). Contract C19: a step that is a sub-process points
     at its chapter ("Sub-process: see section 3.3."), and after 3.2 each
     sub-process with a number has one (3.3 on, depth first): its map on a
     page of its own, then the steps of the reference transaction's first
     visit, "Step 2.1", "Step 2.2", pointing at deeper chapters in turn.
  4. Variations, rules and exceptions: how each other transaction differed
     from the reference transaction (aligned by draft key: extra steps,
     another order, skipped steps, steps done more often than the reference
     did them, and a conditional step not done; the rule is pinned with the
     viewer's Steps by shared/run-differences-golden.json), then the
     business rules and the exceptions.
  5. Data: every field entered, with its system and screen, its step and an
     example value. Re-keyed data (a value typed again in another system in
     the same transaction) is marked and stated as a requirement.
  6. Applications and time: the time of every transaction, and each
     system's screens, steps and time per transaction.
  7. Improvement and automation scope: the analyst's field, and the To-Be
     map when one was chosen.
  8. Notes: only when written.
  8 or 9. Attachments: the files the analyst attached (label and file
     name), only when there are any.

The words (AD-29): one pass through the process is a "transaction" and what
the analyst opens is a "project"; the code and the data keep run, case and
session (case_id, pattern_run, the run_* names below). The capture app's
engagement (engagement_id, engagement_name) is a "request" (AD-30), so
"project" never means anything else.

A "[To be completed: ...]" gap stands only for a document field the analyst
fills in the app. Every number is measured from the recording. Hidden steps
never appear (RP-06); applications carry readable names, never executable
tokens (app_names, step_context); every table has a grid; a map gets a page
of its own, landscape when it is wide, so it prints legibly.

What the analyst adds (contract C16) prints where it belongs: a step's
system (`step.system`) wins over the derived one; a step shows one
screenshot: the one chosen for the PDD (`step.pdd_screenshot`), else its
first (its recorder screenshots come first, then the analyst's), never a
hidden one (lane LF-PIPE: the drafting now gives every screenshot a step);
a step names its attachments. A session without a recording
(manifest.source "video" or "blank") has one implicit run, not a marked
transaction, and says so; a step
without a time (`time_range: null`) orders by its `order` and prints no
time, never a zero. The notes pinned to steps and moments
(annotations.analyst_notes) are not printed.

Sub-processes (contract C19): sections 4 to 9 read the main level only;
what the analyst adds by step_id (screenshots, the one for the PDD,
attachments) resolves at every level.

The activity library (contract C21): a step that is an activity of the
project's library (`step.library_activity`) prints the activity's code
first on its context line ("Code SF-01 · Salesforce, Accounts · ..."), and
the activity's description when the analyst wrote none for the step.

Uses python-docx.
"""

from __future__ import annotations
import json
import logging
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

try:
    from docx import Document
    from docx.enum.section import WD_ORIENT, WD_SECTION
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.image.image import Image as _DocxImage
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, Inches, RGBColor
except ImportError:
    Document = None
    WD_ORIENT = WD_SECTION = WD_ALIGN_PARAGRAPH = None
    _DocxImage = OxmlElement = qn = None
    Pt = Inches = RGBColor = None

from _dt import parse_ts_or_none as _parse_ts
from handoff_versions import HISTORY_HEADER, history_rows, version_line
from library import PROJECT_FILE as LIBRARY_FILE, load_library
from session_io import has_recording, session_source
from step_context import (StepContext, clock, fmt_ms as _fmt_duration, has_video,
                          step_duration_ms, step_start, step_system, untimed_key, video_start)
from step_flow import (END, START, condition_of, cut_positions, left_out_stretches, links_of,
                       node_of)
from recognition import is_browser_chrome
from recorder_noise import is_blank_value
from step_suggest import is_drafted_description, step_identity
from sub_process_maps import map_tree

logger = logging.getLogger(__name__)

# Interaction kinds that put a typed value into a field.
_TYPED_KINDS = ("value_changed", "text_changed")
# Literal junk an old recorder emits as a typed "value": never a business
# value, so it is neither printed nor compared as re-keyed data.
_NOISE_VALUES = frozenset({"null", "(null)", "undefined", "(undefined)"})
# What a secret the recorder redacted (value_redacted) reads as its value in
# the fields typed, the Data section and the Technical details: "Password
# typed (hidden)" (lane LF-PIPE; viewer/step-facts.js SECRET_VALUE).
SECRET_VALUE = "typed (hidden)"
# The shortest typed value compared as re-keyed data: below it, equal values
# are noise (single digits, "OK"). A field whose vocabulary entry declares
# `carries_value: true` is a known business-value carrier, so its values
# count from REKEY_MIN_LEN_VOCAB characters.
REKEY_MIN_LEN = 4
REKEY_MIN_LEN_VOCAB = 2
# A field value longer than this is cut in the document.
_VALUE_MAX = 200
# The line under the times of the transactions (AD-28).
_WALKTHROUGH = ("The transactions were recorded during a walkthrough, with "
                "explanations, so these times show the recording, not the usual "
                "handling time.")
# The capture app labels an unnamed run "Transaction N" ("Run N" before the
# AD-29 words): a label that only repeats the transaction's own name is not
# printed beside it, as in the viewer's list of runs.
_DEFAULT_LABEL_WORDS = ("transaction", "run")
# The step context line's separator (a middle dot, as the viewer's fact line).
_SEP = " · "
# A project without start markers (C16): its one implicit transaction, in the
# words the viewer's Checklist, project line and Timeline use for it
# (viewer/analyst-content.js IMPLICIT_TRANSACTION, lane FX3).
_IMPLICIT = "One transaction (not marked)"
# The System cell of section 6.2 for the steps that have no system (lane FX3):
# never "Not recorded", which read as the name of a system. The Overview
# reads this cell to leave the row out of its one line (analysis-view.js).
NO_SYSTEM = "No system set"
# The capture app's defaults for the request (capture/config.js): a
# recording made without setting one prints no request.
DEFAULT_REQUEST_NAME = "Default engagement"
DEFAULT_REQUEST_CODE = "default"


def write_pdd(
    out_path: Path,
    *,
    session_folder: Path,
    annotations: dict,
    stats: dict,
    manifest: dict,
    analysis: dict | None = None,
    process_map_image: str | Path | None = None,
    tobe_map_image: str | Path | None = None,
    events: list[dict] | None = None,
    map_images: str | Path | None = None,
    map_file: bool | None = None,
    handoff: int | None = None,
    library=None,
) -> None:
    """Write the PDD to `out_path`. `events` is the derived event stream the
    steps' systems, screens and entered fields are read from; without it the
    data section says the field entries were not available. `analysis` is
    accepted for the pipeline's call and not printed: the document holds no
    analysis findings (section 1 of the earlier document is cut). `library`
    is the activity library the steps' `library_activity` names (contract
    C21, library.Library, the one the pipeline's run uses); without it the
    project's library.json is read.

    `map_images` (contract C19, the `--pdd-map-images` manifest) names a
    picture per map, {"maps": [{"path": [<node>, ...], "png": "<file>"}]}:
    the main map's (path []) wins over `process_map_image`, and each
    sub-process's chapter prints its own (_read_map_images). `map_file`
    says whether the project holds process_map_step.bpmn (the run that
    writes the PDD may have written it too, not yet in place); None looks in
    the folder. `handoff` (contract C20, `--handoff`) is the version of
    annotations.handoffs the document is made for; without it the document
    is a working copy (handoff_versions.version_line)."""
    if Document is None:
        raise RuntimeError(
            "python-docx is not installed. Add `python-docx>=1.1.0` to "
            "normalization/requirements.txt and reinstall."
        )
    s = _Session(session_folder, annotations, stats, manifest, events, map_images,
                 library=library)
    s.handoff = handoff
    if map_file is not None:
        s.map_file = bool(map_file)
    doc = Document()
    s.portrait = _page_of(doc.sections[0])
    notes = bool(s.field("notes"))
    _write_title(doc, s)
    _write_document_control(doc, s)                     # 1
    _write_purpose_and_scope(doc, s)                    # 2
    _write_as_is(doc, s, process_map_image)             # 3
    _write_variations(doc, s)                           # 4
    _write_data(doc, s)                                 # 5
    _write_applications_and_time(doc, s)                # 6
    _write_improvement(doc, s, tobe_map_image,          # 7
                       notes or bool(s.attachments))
    _write_notes(doc, s)                                # 8, only when written
    _write_attachments(doc, s, 9 if notes else 8)       # 8 or 9, only when any
    doc.save(str(out_path))


# ---- the session as the document sees it -----------------------------------

def _time_key(ts):
    """A sort key for an ISO timestamp: parsed, so "…21Z" sorts before
    "…21.5Z"; an unreadable one sorts last. Two equal times are equal keys:
    the sort keeps their list order, as the viewer's does (runs-model.js
    byStart), so steps that start at one moment are numbered alike in the
    PDD and in Steps."""
    t = _parse_ts(ts)
    return (t is None, t.timestamp() if t else 0.0)


def _start_key(step):
    """The order of steps (contract C16): a step with a start time by that
    time, then the steps without one (added by hand, `time_range: null`)
    by their `order`."""
    if step_start(step) is not None:
        return _time_key(step["time_range"].get("start"))
    return (True, *untimed_key(step))


def run_rows(stats: dict | None) -> list[dict]:
    """The recording's transactions: the top-level marked cases in
    stats.case_stats, in start order. Section 6.1 and every count of the
    transactions read these rows."""
    rows = [r for r in (stats or {}).get("case_stats") or []
            if isinstance(r, dict) and r.get("case_id") and not r.get("parent_case_id")]
    return sorted(rows, key=lambda r: str(r.get("start_ts") or ""))


def _key_list(value):
    """A list of draft keys (a non-empty list of non-empty strings), else None."""
    if isinstance(value, list) and value and all(isinstance(k, str) and k for k in value):
        return value
    return None


def _step_keys(step):
    """The draft keys a step stands for: [draft_key] for a drafted step, its
    draft_keys for merged drafts, None for a step with no draft identity."""
    if not isinstance(step, dict):
        return None
    dk = step.get("draft_key")
    if isinstance(dk, str) and dk:
        return [dk]
    keys = _key_list(step.get("draft_keys"))
    return list(keys) if keys else None


def _align_key(step) -> str:
    """How a step is matched across runs: its value-free draft_key; else, for
    merged drafts, their draft_keys in order ("merge:" and a JSON array, the
    same text viewer/run-differences.js builds); else (a hand-added step) the
    process_label of its name. step_suggest.step_identity, the one rule the
    repeats and the automation groupings key on too. Pinned with the viewer
    by shared/run-differences-golden.json."""
    return step_identity(step)


def _step_name(step) -> str:
    name = step.get("name")
    return name.strip() if isinstance(name, str) and name.strip() else "(unnamed step)"


def _members(unit) -> list:
    """The steps a unit stands for: the run's steps a merged reference step
    folded (_collapse_merged), else the unit itself."""
    members = unit.get("members") if isinstance(unit, dict) else None
    return members if isinstance(members, list) and members else [unit]


def _unit_ms(unit) -> float | None:
    """A unit's measured time: its members' durations added up, leaving out
    a member without a time range; None when no member has one (C16: a
    step added by hand may have no time, and it is never shown as 0)."""
    timed = [ms for ms in (step_duration_ms(m) for m in _members(unit)) if ms is not None]
    return sum(timed) if timed else None


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


# Where the screenshots the analyst adds by hand live in the session folder
# (C16): screenshots/analyst/<file>, `file` being annotations.analyst_screenshots[].file.
_ANALYST_SHOTS = "screenshots/analyst/"


def _file_name(value) -> str:
    """The file name of an analyst file entry's `file` (C16), without any
    folder part, or "" when it is not a usable name."""
    if not isinstance(value, str):
        return ""
    name = re.split(r"[\\/]", value.strip())[-1]
    return "" if name in ("", ".", "..") else name


def _attachment_label(entry) -> str:
    """An attachment's label (C16), else its file name."""
    label = entry.get("label")
    return label.strip() if isinstance(label, str) and label.strip() else _file_name(entry.get("file"))


def _text_of(v) -> str:
    return v.strip() if isinstance(v, str) else ""


def _read_map_images(manifest) -> dict[tuple[str, ...], Path]:
    """The pictures of the maps (contract C19, `--pdd-map-images`): {path of
    nodes: PNG file} from a manifest {"maps": [{"path": [<node>, ...],
    "png": "<file>"}]}, a relative file read from the manifest's folder, the
    first entry for a path winning. An entry whose file is missing, or not
    of that shape, is left out (its map prints as the table 3.1 falls back
    to); an unreadable manifest gives none, with a warning."""
    if not manifest:
        return {}
    path = Path(manifest)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("pdd_export: the map pictures %s cannot be read (%s: %s); "
                       "the maps print as tables", path, type(exc).__name__, exc)
        return {}
    maps = doc.get("maps") if isinstance(doc, dict) else None
    out: dict[tuple[str, ...], Path] = {}
    for entry in maps if isinstance(maps, list) else []:
        nodes = entry.get("path") if isinstance(entry, dict) else None
        png = entry.get("png") if isinstance(entry, dict) else None
        if not (isinstance(nodes, list) and all(isinstance(n, str) for n in nodes)
                and isinstance(png, str) and png.strip()):
            continue
        file = Path(png.strip())
        if not file.is_absolute():
            file = path.parent / file
        if file.is_file():
            out.setdefault(tuple(nodes), file)
    return out


class _Level:
    """One map of the project as the document reads it (contract C19, a
    map of sub_process_maps.map_tree): its path of nodes, its number ("2",
    "2.1"; None for the main map and for a map with no chapter), its traces
    with the transaction of each, per map node the transactions that ran it
    and the times of its steps, and `first`, the reference transaction's
    first trace: the steps its chapter prints."""

    def __init__(self, m, reference):
        self.path = list(m["path"])
        self.number = m["number"]
        self.traces = m["traces"]
        self.tx = m["transactions"]
        self.reference = reference
        self.runs = len(set(self.tx))
        self.node_runs: dict[str, set] = {}
        self.node_ms: dict[str, list[float]] = {}
        self.node_by_id: dict[str, str] = {}
        for t, trace in zip(self.tx, self.traces):
            for st in trace:
                node = node_of(st)
                self.node_runs.setdefault(node, set()).add(t)
                ms = step_duration_ms(st)
                if ms is not None:
                    self.node_ms.setdefault(node, []).append(ms)
                sid = st.get("step_id")
                if isinstance(sid, str) and sid:
                    self.node_by_id.setdefault(sid, node)
        self.first = next((trace for t, trace in zip(self.tx, self.traces) if t == reference), [])


class _Session:
    """What every section reads, computed once: the visible steps, the runs,
    the reference run (C3), each run's steps aligned to it, the document
    fields (C6), the recorded interactions and where each step happened,
    (C19) the maps of the sub-processes with their chapters, and (C21) the
    project's activity library, `library` (None: the folder's library.json,
    read when a step first names an activity)."""

    def __init__(self, folder, annotations, stats, manifest, events, map_images=None,
                 library=None):
        self.folder = Path(folder)
        self.annotations = annotations if isinstance(annotations, dict) else {}
        self.stats = stats if isinstance(stats, dict) else {}
        self.manifest = manifest if isinstance(manifest, dict) else {}
        self._library = library
        self.portrait = None
        # C20: the hand-off version the document is made for (None: a working copy).
        self.handoff = None
        meta = self.stats.get("meta") or {}
        self.app_names = meta.get("app_names") or {}
        config = self.manifest.get("config")
        worker = config.get("worker") if isinstance(config, dict) else None
        worker = worker if isinstance(worker, dict) else {}
        # The SME's name from the capture profile, else the login it ran under.
        self.recorded_by = _text_of(worker.get("name")) or _text_of(worker.get("id"))
        started = self.manifest.get("started_at")
        self.captured = started[:10] if isinstance(started, str) and len(started) >= 10 else ""
        self.recording_start = _parse_ts(started)
        # C16: a video or blank session has no recording of the screens.
        self.source = session_source(self.manifest)
        self.recorded = has_recording(self.manifest)

        # RP-06: a hidden step never reaches the document.
        self.steps = sorted((st for st in self.annotations.get("steps") or []
                             if isinstance(st, dict) and st.get("state") != "hidden"),
                            key=_start_key)
        self.runs = run_rows(self.stats)
        # C16: the one run of a session without a recording and without
        # marked runs covers the whole session; it is not a marked run.
        self.implicit = any(run.get("implicit") is True for run in self.runs)
        self.analyst_shots = [a for a in self.annotations.get("analyst_screenshots") or []
                              if isinstance(a, dict) and isinstance(a.get("id"), str)
                              and _file_name(a.get("file"))]
        self.attachments = [a for a in self.annotations.get("attachments") or []
                            if isinstance(a, dict) and _file_name(a.get("file"))]
        self.steps_by_run: dict = {}
        for st in self.steps:
            cid = st.get("case_id")
            self.steps_by_run.setdefault(cid if isinstance(cid, str) else None,
                                         []).append(st)
        # C17: a link names its target by step_id; the map node of every
        # visible step, so a link to another transaction's copy of a printed
        # step finds it.
        self.node_by_id = {st["step_id"]: node_of(st) for st in self.steps
                           if isinstance(st.get("step_id"), str)}
        self.run_index = {run["case_id"]: i for i, run in enumerate(self.runs)}
        self.pattern_index = self._pick_pattern()

        self.interactions = {}
        self.times = {}
        for ev in events or []:
            if (isinstance(ev, dict) and ev.get("type") == "interaction"
                    and ev.get("event_id") and isinstance(ev.get("data"), dict)):
                self.interactions[ev["event_id"]] = ev["data"]
                self.times[ev["event_id"]] = str(ev.get("timestamp") or "")
        self.have_events = events is not None
        self.ctx = StepContext(self.interactions, self.app_names)
        self.video_start = video_start(self.manifest, self.annotations)
        self.has_video = has_video(self.manifest, self.annotations)

        # Each run's steps as units aligned to the reference run, and per
        # unit identity: in how many runs it happened and how long it took.
        pattern = self.run_steps(self.pattern_index) if self.pattern_index is not None else []
        self.units = []
        for i in range(len(self.runs)):
            steps = self.run_steps(i)
            self.units.append(steps if i == self.pattern_index or not pattern
                              else _collapse_merged(pattern, steps))
        self.key_runs: Counter = Counter()
        self.key_ms: dict[str, list[float]] = {}     # the timed units only (C16)
        for units in self.units:
            for key in {_align_key(u) for u in units}:
                self.key_runs[key] += 1
            for u in units:
                ms = _unit_ms(u)
                if ms is not None:
                    self.key_ms.setdefault(_align_key(u), []).append(ms)

        # C19: the maps of the project (sub_process_maps.map_tree) over the
        # transactions 3.2 prints from, the reference one numbering them;
        # without a reference transaction, the steps 3.2 lists are the one
        # trace. Each map with a number is a chapter, 3.3 on, depth first.
        if self.pattern_index is not None:
            transactions = [self.run_steps(i) for i in range(len(self.runs))]
            reference = self.pattern_index
            self.reference_case = self.runs[reference]["case_id"]
        else:
            transactions, reference, self.reference_case = [self.steps], 0, None
        self.levels = [_Level(m, reference) for m in map_tree(transactions, reference)]
        self.level_at = {tuple(lv.path): lv for lv in self.levels}
        self.chapters: dict[tuple[str, ...], int] = {}
        for lv in self.levels[1:]:
            if lv.number is not None:
                self.chapters[tuple(lv.path)] = 3 + len(self.chapters)
        self.map_images = _read_map_images(map_images)
        self.map_file = (self.folder / "process_map_step.bpmn").exists()

    def _pick_pattern(self):
        """C3: the run the analyst chose, when it names a recorded run; else
        the first run (by start time) that has steps; else none."""
        chosen = self.annotations.get("pattern_run")
        cid = chosen.get("case_id") if isinstance(chosen, dict) else None
        for i, run in enumerate(self.runs):
            if cid and run["case_id"] == cid:
                return i
        for i, run in enumerate(self.runs):
            if self.steps_by_run.get(run["case_id"]):
                return i
        return None

    def portrait_width_in(self) -> float:
        """The printable width of the document's portrait page, in inches."""
        p = self.portrait or {}
        try:
            return (p["width"] - p["left"] - p["right"]) / 914400
        except (KeyError, TypeError):
            return 6.0

    def field(self, key) -> str:
        doc = self.annotations.get("document")
        value = doc.get(key) if isinstance(doc, dict) else None
        return value.strip() if isinstance(value, str) else ""

    def request(self) -> str:
        """The capture's request (its engagement, AD-30), as the viewer's
        project line names it (session-summary.js requestOf): its name and
        its code, "Invoice intake review (REQ-2026-042)", the name or the
        code alone, or "" when the capture app's defaults were left (the name
        "Default engagement", the code "default")."""
        config = self.manifest.get("config")
        config = config if isinstance(config, dict) else {}
        name = _text_of(self.manifest.get("engagement_name")) or _text_of(config.get("engagement_name"))
        name = "" if name == DEFAULT_REQUEST_NAME else name
        code = _text_of(self.manifest.get("engagement_id"))
        code = "" if code == DEFAULT_REQUEST_CODE else code
        if name and code and name != code:
            return f"{name} ({code})"
        return name or code

    def run_label(self, index) -> str:
        """"Transaction 2: Refund", or "Transaction 2" when the run has no
        label or its label only repeats that name ("Transaction 2", or the
        capture app's older "Run 2")."""
        label = self.runs[index].get("label")
        label = label.strip() if isinstance(label, str) else ""
        if label.lower() in {f"{word} {index + 1}" for word in _DEFAULT_LABEL_WORDS}:
            label = ""
        return f"Transaction {index + 1}: {label}" if label else f"Transaction {index + 1}"

    def run_steps(self, index) -> list:
        return self.steps_by_run.get(self.runs[index]["case_id"], [])

    def left_out(self, index) -> list[tuple]:
        """The stretches of run `index` left out of the analysis
        (annotations.excluded_ranges cut to the run's span, a run left open
        reaching to the end: _left_out_stretches)."""
        run = self.runs[index]
        return _left_out_stretches(self.annotations.get("excluded_ranges"),
                                   _parse_ts(run.get("start_ts")), _parse_ts(run.get("end_ts")))

    def run_units(self) -> list:
        """Every unit of every run, the reference run first."""
        order = ([self.pattern_index] if self.pattern_index is not None else []) + [
            i for i in range(len(self.runs)) if i != self.pattern_index]
        return [u for i in order for u in self.units[i]]

    def where(self, step) -> str:
        """"System, screen" of a step ("" when unknown)."""
        system, screen = self.ctx.where(_members(step)[0])
        return ", ".join(x for x in (system, screen) if x)

    def system_of(self, step) -> str:
        return self.ctx.where(_members(step)[0])[0]

    def position(self, step, case_id=None) -> str:
        """Where a step is in the recording: its transaction and its time
        from the start of the recording ("Transaction 1 at 0:19": the same
        on every machine, whatever its time zone), and the video time when
        the video's start is known ("Transaction 1 at 0:19 (video 12:45)");
        for a step outside every run, "0:19 into the recording". A step
        without a time has no place (C16). In a video session the session's
        clock is the video's, so the place is the video time ("Transaction
        1, video 0:19", "video 0:19" in the implicit run, which is not a
        marked transaction). `case_id`, when given, is the step's
        transaction (a sub-step's, contract C19: its parent's)."""
        start = step_start(_members(step)[0])
        if start is None:
            return ""
        cid = step.get("case_id") if case_id is None else case_id
        index = self.run_index.get(cid) if isinstance(cid, str) and not self.implicit else None
        if (self.source == "video" and self.video_start is not None
                and start >= self.video_start):
            video = "video " + clock((start - self.video_start).total_seconds() * 1000)
            return f"Transaction {index + 1}, {video}" if index is not None else video
        at = ""
        if self.recording_start is not None and start >= self.recording_start:
            at = clock((start - self.recording_start).total_seconds() * 1000)
        if index is not None:
            out = f"Transaction {index + 1} at {at}" if at else f"Transaction {index + 1}"
        else:
            out = f"{at} into the recording" if at else ""
        if self.video_start is not None and start >= self.video_start:
            video = "video " + clock((start - self.video_start).total_seconds() * 1000)
            out = f"{out} ({video})" if out else video
        return out

    def activity(self, step):
        """The library activity a step is (contract C21): the activity of
        the project's library its `library_activity` names, or None."""
        aid = step.get("library_activity") if isinstance(step, dict) else None
        if not isinstance(aid, str) or not aid:
            return None
        if self._library is None:
            self._library = load_library(self.folder / LIBRARY_FILE)
        return self._library.activities.get(aid)

    def description(self, step) -> str:
        """The step's description as the document prints it: the analyst's
        (analyst_description), else the description of the library activity
        the step is (contract C21), else ""."""
        desc = self.analyst_description(step)
        if desc:
            return desc
        activity = self.activity(step)
        return activity.description if activity is not None else ""

    def context_line(self, step, level=None) -> str:
        """The line under a step's heading: the code of the library activity
        the step is (contract C21, "Code SF-01"), system and screen, its
        average time, in how many transactions it happened ("in 3 of 4
        transactions"), where it is in the recording. Contract C16: the time
        leaves out the steps without a time range and is not said when none
        of them has one; the implicit run (transactions not marked) is not
        counted. Contract C19: a sub-step of a chapter (`level`, its map) is
        timed and counted over its map's traces, out of the transactions
        that ran its sub-process, and placed in the reference transaction."""
        parts = []
        activity = self.activity(step)
        if activity is not None and activity.code:
            parts.append(f"Code {activity.code}")
        where = self.where(step)
        if where:
            parts.append(where)
        own = _unit_ms(step)
        sub = level is not None and bool(level.path)
        if sub and self.pattern_index is not None:
            node = node_of(step)
            durations = level.node_ms.get(node) or ([own] if own is not None else [])
            if durations:
                parts.append(_duration(sum(durations) / len(durations)) + " on average")
            if not self.implicit:
                parts.append(f"in {len(level.node_runs.get(node) or ()) or 1} of "
                             f"{_plural(level.runs, 'transaction')}")
        elif sub:
            if own is not None:
                parts.append(_duration(own))
        elif self.runs:
            key = _align_key(step)
            durations = self.key_ms.get(key) or ([own] if own is not None else [])
            if durations:
                parts.append(_duration(sum(durations) / len(durations)) + " on average")
            if not self.implicit:
                parts.append(f"in {self.key_runs.get(key) or 1} of "
                             f"{_plural(len(self.runs), 'transaction')}")
        elif own is not None:
            parts.append(_duration(own))
        position = self.position(step, self.reference_case if sub else None)
        if position:
            parts.append(position)
        return _SEP.join(parts)

    def analyst_description(self, step) -> str:
        """The step's description when the analyst wrote it. A draft's
        description is the drafting's narration of its interactions, which
        the step's field list and screenshots already carry: a description
        that still equals it (recomputed with the same function,
        step_suggest.is_drafted_description) is left out. Without the events
        (none given to the export, or an interaction missing) it cannot be
        recomputed, so it is shown."""
        desc = step.get("description")
        desc = desc.strip() if isinstance(desc, str) else ""
        if not desc:
            return ""
        ids = (step.get("evidence") or {}).get("interaction_event_ids") or []
        datas = [self.interactions.get(eid) for eid in ids]
        if not self.have_events or not ids or any(d is None for d in datas):
            return desc
        return "" if is_drafted_description(desc, [{"data": d} for d in datas]) else desc

    def what_was_done(self, step) -> str:
        """For a step outside the reference run: the analyst's description,
        else its library activity's (description); else the fields it
        entered; else the drafting's narration of what was done (its
        clicks), each sentence once."""
        for member in _members(step):
            desc = self.description(member) if isinstance(member, dict) else ""
            if desc:
                return " ".join(desc.split())
        fields = self.field_names(step)
        if fields:
            return "Fields: " + ", ".join(fields) + "."
        for member in _members(step):
            desc = member.get("description") if isinstance(member, dict) else None
            desc = desc.strip() if isinstance(desc, str) else ""
            if desc:
                seen: dict[str, None] = {}
                for sentence in re.split(r"(?<=\.)\s+", desc):
                    if sentence.strip():
                        seen.setdefault(sentence.strip(), None)
                return " ".join(seen)
        return ""

    def entries(self, step) -> list[tuple[str, str, dict, str, dict]]:
        """(field, value, interaction data, timestamp, step) of every field
        entry in a step (its members' interactions, in order); the step is
        the member the entry belongs to."""
        out = []
        for member in _members(step):
            for eid in (member.get("evidence") or {}).get("interaction_event_ids") or []:
                data = self.interactions.get(eid)
                got = _entered(data)
                if got:
                    out.append((got[0], got[1], data, self.times.get(eid, ""), member))
        return out

    def entry_where(self, member, data) -> tuple[str, str]:
        """(system, screen) of one field entry: where its interaction was,
        the system the analyst set on its step first (C16), the screen its
        step's when the drafting made that one value-free (lane LF-PIPE)."""
        system, screen = self.ctx.where_datas([data])
        system = step_system(member) or system
        return system, self.ctx.value_free_screen(member, system) or screen

    def field_names(self, step) -> list[str]:
        """The distinct fields entered in a step, in the order first entered."""
        seen: dict[str, None] = {}
        for field, _value, _data, _ts, _member in self.entries(step):
            seen.setdefault(field, None)
        return list(seen)

    def screenshots(self, step) -> list[str]:
        """The screenshot (session-relative path, in a list of one or none)
        the document prints under a step (contract C16): the one the analyst
        chose for the PDD (`pdd_screenshot`: a recorder screenshot's path or
        an analyst screenshot's id) when that file is in the session folder;
        else the step's first screenshot whose file is there, its recorder
        screenshots first and then the ones the analyst added to it (lane
        LF-PIPE: one per step, as a step now gets every screenshot taken
        while it ran or before it). A recorder screenshot the analyst took
        off the step (`hidden_screenshots`) is never printed, nor one
        outside the folder."""
        hidden = {h for h in step.get("hidden_screenshots") or [] if isinstance(h, str)}
        choice = step.get("pdd_screenshot")
        chosen = self.screenshot_ref(choice)
        if (chosen and choice not in hidden and chosen not in hidden
                and (path := _safe_path(self.folder, chosen)) is not None and path.is_file()):
            return [chosen]
        refs = [r for r in (step.get("evidence") or {}).get("screenshot_refs") or []
                if not (isinstance(r, str) and r in hidden)]
        sid = step.get("step_id")
        if isinstance(sid, str) and sid:
            refs += [_ANALYST_SHOTS + _file_name(a["file"]) for a in self.analyst_shots
                     if a.get("step_id") == sid and a["id"] not in hidden]
        for ref in refs:
            path = _safe_path(self.folder, ref)
            if path is None:
                logger.warning("pdd_export: skipping out-of-folder screenshot ref %r for step %s",
                               ref, step.get("step_id", "?"))
            elif path.is_file():
                return [ref]
        return []

    def screenshot_ref(self, ref) -> str:
        """The session-relative path a screenshot reference names: an
        analyst screenshot's file under screenshots/analyst/ for its id,
        else the reference itself (a recorder screenshot's path)."""
        if not isinstance(ref, str) or not ref.strip():
            return ""
        for shot in self.analyst_shots:
            if shot["id"] == ref:
                return _ANALYST_SHOTS + _file_name(shot["file"])
        return ref

    def step_attachments(self, step) -> list[str]:
        """The labels of the attachments on a step (C16), in their order."""
        sid = step.get("step_id")
        if not isinstance(sid, str) or not sid:
            return []
        return [_attachment_label(a) for a in self.attachments if a.get("step_id") == sid]


def _entered(data) -> tuple[str, str] | None:
    """(field, value) when this interaction entered a value into a field.
    Lane LF-PIPE: a secret the recorder redacted reads SECRET_VALUE ("typed
    (hidden)": "Password typed (hidden)"); a value made only of U+FFFC and
    whitespace (an empty web field) is no value; the browser's address bar
    is a navigation, never a field; and a choice whose control is named by
    the option itself (a list item "Croatia", a cell "A2") names no field:
    the option text is never a field's name."""
    if not isinstance(data, dict) or is_browser_chrome(data):
        return None
    kind = data.get("kind")
    if kind in _TYPED_KINDS:
        if data.get("value_redacted") is True:
            value = SECRET_VALUE
        else:
            raw = data.get("value")
            value = raw.strip() if isinstance(raw, str) else ""
            if not value or value.lower() in _NOISE_VALUES or is_blank_value(value):
                return None
    elif kind == "selection_changed" and data.get("control_type") not in ("TabItem", "Tab"):
        raw = data.get("selected_value")
        value = raw.strip() if isinstance(raw, str) else ""
        label = data.get("meaningful_name") or data.get("name")
        if not value or (isinstance(label, str) and label.strip() == value):
            return None
    else:
        return None
    if len(value) > _VALUE_MAX:
        value = value[:_VALUE_MAX - 1] + "…"
    for key in ("meaningful_name", "name", "automation_id"):
        name = data.get(key)
        if isinstance(name, str) and name.strip():
            return name.strip(), value
    return "(unnamed field)", value


# ---- shared bits ------------------------------------------------------------

def _page_of(section) -> dict:
    return {"width": section.page_width, "height": section.page_height,
            "left": section.left_margin, "right": section.right_margin,
            "top": section.top_margin, "bottom": section.bottom_margin}


def _set_page(section, portrait: dict, landscape: bool) -> None:
    """Portrait with the document's own page, or landscape with narrow
    margins for a map."""
    if landscape:
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width, section.page_height = portrait["height"], portrait["width"]
        section.left_margin = section.right_margin = Inches(0.75)
        section.top_margin = section.bottom_margin = Inches(0.75)
    else:
        section.orientation = WD_ORIENT.PORTRAIT
        section.page_width, section.page_height = portrait["width"], portrait["height"]
        section.left_margin, section.right_margin = portrait["left"], portrait["right"]
        section.top_margin, section.bottom_margin = portrait["top"], portrait["bottom"]


def _placeholder(doc, text):
    """An italic, clearly-marked gap for the analyst to complete."""
    p = doc.add_paragraph()
    p.add_run(f"[To be completed: {text}]").italic = True
    return p


def _small(doc, text, italic=False):
    """A small line: the step context under a step heading, a caption."""
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = italic
    if Pt is not None:
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    return p


def _text(doc, text):
    """A multi-line analyst text, one paragraph per non-empty line."""
    for line in text.splitlines():
        if line.strip():
            doc.add_paragraph(line.rstrip())


def _field_or_placeholder(doc, text, placeholder):
    """C6: the analyst's field in place of the placeholder when it is set."""
    if text:
        _text(doc, text)
    else:
        _placeholder(doc, placeholder)


def _shade(cell, fill="E7E6E6"):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _bold(cell):
    for p in cell.paragraphs:
        for run in p.runs:
            run.bold = True


def _widths(table, inches):
    """Fixed column widths (inches), so a table reads the same in every
    viewer."""
    if not inches or Inches is None:
        return
    table.autofit = False
    for row in table.rows:
        for cell, width in zip(row.cells, inches):
            cell.width = Inches(width)


def _table(doc, header, rows, widths=None):
    """A grid table with a shaded, bold header row that repeats on every page."""
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    for cell, text in zip(t.rows[0].cells, header):
        cell.text = text
        _bold(cell)
        _shade(cell)
    tr_pr = t.rows[0]._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    tr_pr.append(repeat)
    for row in rows:
        for cell, text in zip(t.add_row().cells, row):
            cell.text = str(text)
    _widths(t, widths)
    return t


def _kv_table(doc, rows):
    """A two-column grid table, the labels bold and shaded."""
    t = doc.add_table(rows=0, cols=2)
    t.style = "Table Grid"
    for k, v in rows:
        c = t.add_row().cells
        c[0].text = str(k)
        c[1].text = str(v)
        _bold(c[0])
        _shade(c[0])
    _widths(t, (1.8, 4.2))
    return t


def _plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def _joined(items):
    items = [str(i) for i in items]
    if not items:
        return ""
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _duration(ms) -> str:
    """A step or run time: "12s", "1m 07s"; "under 1s" below half a second."""
    if not _num(ms):
        return "-"
    return "under 1s" if ms < 500 else _fmt_duration(ms)


def _fmt_ms(ms):
    """A duration ("46s", "1m 07s", step_context.fmt_ms). A non-numeric
    value (hand-edited annotations, odd analysis) is "-"."""
    if not _num(ms):
        return "-"
    return _fmt_duration(ms)


def _image_px(path) -> tuple[int, int] | None:
    """(width, height) in pixels of an image python-docx can embed, or None."""
    try:
        img = _DocxImage.from_file(str(path))
        if img.px_width > 0 and img.px_height > 0:
            return img.px_width, img.px_height
    except Exception as exc:  # noqa: BLE001 (an unreadable image is not embedded)
        logger.warning("pdd_export: cannot read image %s: %s", path, exc)
    return None


def _map_page(doc, s, image, heading, alt, caption, then_portrait,
              section_heading="") -> bool:
    """A map on a page of its own: landscape when the image is wider than it
    is tall, the picture as large as the page allows (so its labels print
    legibly), with `alt` as the picture's alternative text. The page opens
    with `section_heading` (a level 1 heading) when given. Returns False
    (nothing written) when the image is missing or unreadable."""
    if not image or not Path(image).exists() or Inches is None:
        return False
    px = _image_px(image)
    if px is None:
        return False
    landscape = px[0] > px[1]
    _set_page(doc.add_section(WD_SECTION.NEW_PAGE), s.portrait, landscape)
    if section_heading:
        doc.add_heading(section_heading, level=1)
    doc.add_heading(heading, level=2)
    # The printable area below the headings and above the caption.
    avail_w, avail_h = (9.5, 5.9) if landscape else (s.portrait_width_in(), 7.9)
    if section_heading:
        avail_h -= 0.5
    width = min(avail_w, avail_h * px[0] / px[1])
    try:
        shape = doc.add_picture(str(image), width=Inches(width))
    except (FileNotFoundError, OSError, ValueError) as exc:
        logger.warning("pdd_export: could not embed map %s: %s", image, exc)
        return False
    shape._inline.docPr.set("descr", alt)
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    if caption:
        _small(doc, caption, italic=True)
    if then_portrait:
        _set_page(doc.add_section(WD_SECTION.NEW_PAGE), s.portrait, False)
    return True


# ---- title, 1. Document control, 2. Purpose and scope ------------------------

def _write_title(doc, s):
    title = s.field("title")
    if title:
        doc.add_heading(title, level=0)
        doc.add_paragraph("Process Definition Document", style="Subtitle")
    else:
        doc.add_heading("Process Definition Document", level=0)


def _write_document_control(doc, s):
    doc.add_heading("1. Document control", level=1)
    # C16: a blank session recorded nothing; the implicit run of a session
    # without a recording is not a marked transaction.
    recorded = ("Nothing recorded" if s.source == "blank"
                else s.captured or "Not recorded")
    rows = [
        ("Process", s.field("title") or "Not named yet"),
        ("Project folder", s.folder.resolve().name or "Not recorded"),
        ("Recorded", recorded),
        ("Recorded by", s.recorded_by or "Not recorded"),
        ("Transactions recorded", _IMPLICIT if s.implicit else str(len(s.runs))),
        ("Video", "Attached" if s.has_video else "None"),
    ]
    # AD-30: the capture's engagement is the Request; "project" is only
    # what the analyst opens (the Project folder row above).
    request = s.request()
    if request:
        rows.append(("Request", request))
    # C20: every PDD says which version it is: the hand-off it is made for,
    # else a working copy (after the latest hand-off, or before the first).
    rows += [("Document generated", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
             ("Version", version_line(s.annotations, s.handoff))]
    _kv_table(doc, rows)
    history = history_rows(s.annotations)
    if history:
        label = doc.add_paragraph()
        label.add_run("Version history").bold = True
        if Pt is not None:
            # Clear of the table above, close to its own.
            label.paragraph_format.space_before = Pt(12)
            label.paragraph_format.space_after = Pt(4)
        _table(doc, HISTORY_HEADER, history, widths=(0.8, 1.1, 1.3, 2.8))


# The analyst's fields of section 2 (C6), each with the gap it leaves empty.
_INTRO_FIELDS = (
    ("2.1", "Purpose", "purpose",
     "the business need this process serves and why it is being documented"),
    ("2.2", "Scope", "scope", "what the process covers and what it leaves out"),
    ("2.3", "Trigger", "trigger", "the event that starts the process"),
    ("2.4", "Result", "result", "what the process has produced when it ends"),
    ("2.5", "Key contacts", "contacts",
     "the process owner, the subject-matter expert and the analyst"),
)


def _write_purpose_and_scope(doc, s):
    doc.add_heading("2. Purpose and scope", level=1)
    for number, title, key, gap in _INTRO_FIELDS:
        doc.add_heading(f"{number} {title}", level=2)
        _field_or_placeholder(doc, s.field(key), gap)


# ---- 3. As-Is process -----------------------------------------------------------

def _systems_in_order(s) -> list[str]:
    """The systems of the process, in the order the reference run (then the
    other runs, then the steps outside the runs) first used them."""
    seen: dict[str, None] = {}
    outside = s.steps_by_run.get(None, []) if s.runs else s.steps
    for unit in s.run_units() + outside:
        system = s.system_of(unit)
        if system:
            seen.setdefault(system, None)
    return list(seen)


def _flow_rows(s) -> list[tuple[str, str]]:
    """The map from the runs as rows (step, what followed it): for each step
    of the runs, in the order the reference run (then the others) first did
    it, the steps that came next, each with the number of transactions in
    which it did ("Save (3 of 4 transactions)"). A step repeated back to
    back counts once, as on the map. A stretch left out of the analysis cuts
    the transaction's trace, as on the map (step_flow): no step follows
    another across it, and a stretch that opens (closes) the transaction
    leaves out its path from the start (to the end)."""
    runs = len(s.runs)
    names: dict[str, str] = {"start": "Start", "end": "End"}
    order: dict[str, None] = {"start": None}
    follows: dict[str, dict[str, set]] = {}
    ordered_runs = ([s.pattern_index] if s.pattern_index is not None else []) + [
        i for i in range(runs) if i != s.pattern_index]
    for i in ordered_runs:
        units = s.units[i]
        if not units:
            continue
        n = len(units)
        cuts = cut_positions([step_start(_members(u)[0]) for u in units], s.left_out(i))
        bounds = [0] + [c for c in cuts if 0 < c < n] + [n]
        for part, (lo, hi) in enumerate(zip(bounds, bounds[1:])):
            keys = []
            for unit in units[lo:hi]:
                key = _align_key(unit)
                names.setdefault(key, _step_name(unit))
                if not keys or keys[-1] != key:
                    keys.append(key)
            path = ((["start"] if part == 0 and 0 not in cuts else []) + keys
                    + (["end"] if hi == n and n not in cuts else []))
            for a, b in zip(path, path[1:]):
                order.setdefault(a, None)
                follows.setdefault(a, {}).setdefault(b, set()).add(i)
    rows = []
    for key in order:
        nexts = follows.get(key)
        if not nexts:
            continue
        parts = sorted(nexts.items(), key=lambda kv: -len(kv[1]))
        # The implicit run (C16) is not a marked transaction: no counts.
        rows.append((names[key], "; ".join(
            names[b] if s.implicit
            else f"{names[b]} ({len(r)} of {_plural(runs, 'transaction')})"
            for b, r in parts)))
    return rows


def _write_as_is(doc, s, process_map_image):
    """3: the As-Is map on a page of its own (the section's heading on the
    same page), then the steps. Without a picture of the map (the viewer
    passes one), the map from the runs as a table, so the section is never
    empty. Contract C19: the main map's picture in the map pictures'
    manifest wins over `process_map_image`, and the chapters of the
    sub-processes follow the steps (_write_sub_processes)."""
    image = s.map_images.get(()) or process_map_image
    if not _map_page(doc, s, image, "3.1 As-Is process map",
                     "As-Is process map", "", then_portrait=True,
                     section_heading="3. As-Is process"):
        doc.add_heading("3. As-Is process", level=1)
        doc.add_heading("3.1 As-Is process map", level=2)
        rows = _flow_rows(s) if s.runs else []
        if rows:
            doc.add_paragraph("Each step and the step that followed it:" if s.implicit
                              else "Each step and the steps that followed it in the transactions:")
            _table(doc, ("Step", "Followed by"), rows, widths=(2.4, 3.6))
        else:
            doc.add_paragraph(_no_map_reason(s))
        if s.map_file:
            doc.add_paragraph("The map file is process_map_step.bpmn in the project folder.")
    _write_steps(doc, s)
    _write_sub_processes(doc, s)


def _no_map_reason(s) -> str:
    """Why 3.1 has no map: the transactions were not marked, or they hold no
    step. A project without a recording (C16) always has its one implicit
    transaction, so its reason is never the markers: it has no steps yet."""
    if not s.runs:
        return "Transactions were not marked in this recording, so there is no map."
    if not s.recorded and not s.steps:
        return "No steps have been added to this project yet, so there is no map."
    return "None of the transactions has steps, so there is no map."


def _write_steps(doc, s):
    doc.add_heading("3.2 Process steps", level=2)
    systems = _systems_in_order(s)
    if systems:
        doc.add_paragraph(f"The process runs through {_joined(systems)}.")
    if s.pattern_index is None:
        steps = s.steps
        if steps:
            why = ("Transactions were not marked in this recording" if not s.runs
                   else "None of the recorded transactions has steps")
            doc.add_paragraph(f"{why}, so every step is listed in time order.")
    else:
        steps = s.run_steps(s.pattern_index)
        if s.implicit:
            # C16: one implicit run holds every step; the order is the time,
            # then `order` for the steps added without a time.
            doc.add_paragraph(f"{_IMPLICIT}, so every step is listed in order.")
        else:
            doc.add_paragraph(f"The steps as done in {s.run_label(s.pattern_index)}, "
                              "the reference transaction.")
        _drafts_line(doc, steps)
    if not steps:
        if not s.recorded:
            doc.add_paragraph("No steps have been added to this project yet.")
        else:
            doc.add_paragraph("No steps have been recorded for this transaction yet."
                              if s.pattern_index is not None
                              else "No steps have been recorded for this project yet.")
        return
    for number, step in enumerate(steps, start=1):
        _write_step(doc, s, step, number, steps, s.levels[0])


def _drafts_line(doc, steps) -> None:
    """How many of the printed steps are drafts, when any is."""
    drafts = sum(1 for st in steps if st.get("state") == "auto_suggested")
    if drafts:
        doc.add_paragraph(f"{drafts} of these {_plural(len(steps), 'step')} "
                          f"{'is a draft' if drafts == 1 else 'are drafts'} "
                          "not confirmed yet.")


def _level_rows(s, level) -> list[tuple[str, str]]:
    """3.1's table for a sub-process's map (contract C19): each step of its
    traces, in the order the reference transaction (then the others) first
    did it, and the steps that came next, each with the number of the
    transactions that ran the sub-process in which it did ("Save (1 of 2
    transactions)"). A step repeated back to back counts once, as on the
    map; nothing is counted in the implicit run (C16) or without a
    reference transaction."""
    counted = s.pattern_index is not None and not s.implicit
    names: dict[str, str] = {START: "Start", END: "End"}
    order: dict[str, None] = {START: None}
    follows: dict[str, dict[str, set]] = {}
    for t, trace in sorted(zip(level.tx, level.traces), key=lambda p: p[0] != level.reference):
        nodes: list[str] = []
        for st in trace:
            node = node_of(st)
            names.setdefault(node, _step_name(st))
            if not nodes or nodes[-1] != node:
                nodes.append(node)
        path = [START] + nodes + [END]
        for a, b in zip(path, path[1:]):
            order.setdefault(a, None)
            follows.setdefault(a, {}).setdefault(b, set()).add(t)
    rows = []
    for key in order:
        nexts = follows.get(key)
        if not nexts:
            continue
        parts = sorted(nexts.items(), key=lambda kv: -len(kv[1]))
        rows.append((names[key], "; ".join(
            f"{names[b]} ({len(r)} of {_plural(level.runs, 'transaction')})" if counted
            else names[b] for b, r in parts)))
    return rows


def _write_sub_processes(doc, s):
    """Contract C19: after 3.2, one section per sub-process map with a
    number, depth first: "3.<k> Sub-process <number>: <name>", the name the
    step it is numbered by has. Its map sits on a page of its own (its
    picture from the map pictures' manifest, else its steps and the steps
    that followed them as a table, as 3.1 falls back to), then the steps of
    the reference transaction's first visit, numbered "<number>.<i>" and
    printed like 3.2's (_write_step), each pointing at a deeper chapter in
    turn."""
    for lv in s.levels[1:]:
        k = s.chapters.get(tuple(lv.path))
        if k is None:
            continue
        parent = s.level_at.get(tuple(lv.path[:-1]))
        numbered_by = next((st for st in (parent.first if parent else [])
                            if node_of(st) == lv.path[-1]), None)
        name = _step_name(numbered_by) if numbered_by is not None else lv.path[-1]
        heading = f"3.{k} Sub-process {lv.number}: {name}"
        if not _map_page(doc, s, s.map_images.get(tuple(lv.path)), heading,
                         f"As-Is process map, sub-process {lv.number}", "", then_portrait=True):
            doc.add_heading(heading, level=2)
            rows = _level_rows(s, lv)
            if not rows:
                doc.add_paragraph("No steps have been added to this sub-process yet, "
                                  "so there is no map.")
                continue
            counted = s.pattern_index is not None and not s.implicit
            doc.add_paragraph("Each step and the steps that followed it in the transactions:"
                              if counted else "Each step and the step that followed it:")
            _table(doc, ("Step", "Followed by"), rows, widths=(2.4, 3.6))
        steps = lv.first
        if not steps:
            doc.add_paragraph("No steps have been added to this sub-process yet."
                              if not lv.traces
                              else "The reference transaction has no steps in this sub-process.")
            continue
        _drafts_line(doc, steps)
        for number, step in enumerate(steps, start=1):
            _write_step(doc, s, step, number, steps, lv)


def _sentence(text: str) -> str:
    """An analyst's condition closing a sentence: one final full stop, none
    added after a question or exclamation mark."""
    text = text.rstrip().rstrip(".").rstrip()
    return text if text.endswith(("?", "!", "…")) else text + "."


def _link_lines(s, step, number, steps, level=None) -> list[str]:
    """One line per link on the step (contract C17), in their order: "Then
    goes back to step N, <name>, when <when>." for an earlier step (or the
    step itself), "Then goes on to step N ..." for the next one, "Then skips
    to step N ..." for a later one, "The process ends here when <when>."
    for the end; without a `when`, the line ends at the step's name. A
    target takes the number the document prints it with (`steps`, the
    printed steps): its own, else that of the first printed step with its
    map node (another transaction's copy of a printed step). A link to its
    own step, to a hidden or removed step, or to a step with no printed copy
    is left out. Contract C19: in a sub-process's chapter (`level`, its map)
    a target is numbered as the chapter numbers it ("step 2.1"), and an end
    ends the sub-process only ("The sub-process ends here ...")."""
    sub = level is not None and bool(level.path)
    numbers = {st.get("step_id"): i for i, st in enumerate(steps, start=1)
               if isinstance(st.get("step_id"), str)}
    by_node: dict[str, int] = {}
    for i, st in enumerate(steps, start=1):
        by_node.setdefault(node_of(st), i)
    node_by_id = level.node_by_id if sub else s.node_by_id
    ends = "The sub-process ends here" if sub else "The process ends here"
    lines = []
    for to, when in links_of(step):
        if to == "end":
            lines.append(f"{ends} when {_sentence(when)}" if when else f"{ends}.")
            continue
        if to == step.get("step_id"):
            continue
        n = numbers.get(to)
        if n is None and to in node_by_id:
            n = by_node.get(node_by_id[to])
        if n is None:
            continue
        verb = ("goes back to" if n <= number
                else "goes on to" if n == number + 1 else "skips to")
        target = f"Then {verb} step {_step_number(n, level)}, {_step_name(steps[n - 1])}"
        lines.append(f"{target}, when {_sentence(when)}" if when else f"{target}.")
    return lines


def _step_number(number, level=None) -> str:
    """A step's number as the document prints it: "2" at the main level,
    "<the sub-process's number>.<number>" ("2.1") in a sub-process's
    chapter (contract C19). It always follows the word "step" ("Step 2.1:
    ...", "goes back to step 2.1"), so it never reads as the number of a
    section (lane FX1)."""
    sub = level is not None and bool(level.path)
    return f"{level.number}.{number}" if sub else str(number)


def _write_step(doc, s, step, number, steps, level=None):
    """One printed step: its heading ("Step 2: <name>"), its context line,
    "Only when" its condition, its description when the analyst wrote it
    (else its library activity's, C21), the fields it entered, its
    attachments, its screenshots, the waste flag and its flow (C17).
    Contract C19: `level` is the map it is drawn in; in a
    sub-process's chapter it is numbered "Step <chapter number>.<number>". A
    group of steps (`group: true`) prints no fields and no screenshot: its
    chapter prints its steps with theirs. A step whose map node has a
    chapter ends with the line that points at its section."""
    doc.add_heading(f"Step {_step_number(number, level)}: {_step_name(step)}", level=3)
    context = s.context_line(step, level)
    if context:
        _small(doc, context)
    condition = condition_of(step)
    if condition:
        # C17: the step happens only under this condition.
        doc.add_paragraph(f"Only when {_sentence(condition)}")
    desc = s.description(step)
    if desc:
        _text(doc, desc)
    group = step.get("group") is True
    fields = [] if group else s.field_names(step)
    if fields:
        doc.add_paragraph("Fields: " + ", ".join(fields) + ".")
    attached = s.step_attachments(step)
    if attached:
        doc.add_paragraph("Attachments: " + ", ".join(attached) + ".")
    # Lane FX3: each screenshot's alternative text names its step, as the
    # map pictures' name their map.
    alt = f"Screenshot of step {_step_number(number, level)}: {_step_name(step)}"
    for ref in [] if group else s.screenshots(step):
        _embed_screenshot(doc, s.folder, ref, step, alt)
    if (step.get("flags") or {}).get("waste") is True:
        p = doc.add_paragraph("Flagged as waste.")
        for run in p.runs:
            run.italic = True
    # C17: where the process goes after the step, besides the next step.
    for line in _link_lines(s, step, number, steps, level):
        doc.add_paragraph(line)
    # C19: the chapter of the sub-process the step stands for.
    chapter = s.chapters.get(tuple((level.path if level is not None else []) + [node_of(step)]))
    if chapter is not None:
        doc.add_paragraph(f"Sub-process: see section 3.{chapter}.")


def _safe_path(folder, ref):
    """The file a session-relative reference names, or None when the
    reference is not a relative path inside the session folder. `ref` is
    untrusted (it comes from annotations.json). pathlib honours absolute
    paths and `..`, so a malicious ref could embed an off-folder image into
    the export. Resolve and require containment (SEC Vuln 2)."""
    if not isinstance(ref, str) or not ref or Path(ref).is_absolute():
        return None
    full = (Path(folder) / ref).resolve()
    base = Path(folder).resolve()
    if base != full and base not in full.parents:
        return None
    return full


def _embed_screenshot(doc, folder, ref, step, alt=""):
    """One screenshot under its step, `alt` its alternative text (the step's
    number and name, lane FX3)."""
    full = _safe_path(folder, ref)
    if full is None:
        logger.warning("pdd_export: skipping out-of-folder screenshot ref %r for step %s",
                       ref, step.get("step_id", "?"))
        return
    if full.exists() and Inches is not None:
        try:
            shape = doc.add_picture(str(full), width=Inches(4.5))
        except (FileNotFoundError, OSError, ValueError) as exc:
            logger.warning("pdd_export: skipping screenshot %s for step %s: %s",
                           ref, step.get("step_id", "?"), exc)
            return
        if alt:
            shape._inline.docPr.set("descr", alt)


# ---- 4. Variations, rules and exceptions ------------------------------------------

def _first_occurrences(steps):
    """(key, step, index in `steps`) for the first step of each align key."""
    seen, out = set(), []
    for i, step in enumerate(steps):
        key = _align_key(step)
        if key not in seen:
            seen.add(key)
            out.append((key, step, i))
    return out


def _common_order(a, b) -> set:
    """The keys of a longest common subsequence of two key lists (each key
    at most once per list): the steps both runs did in the same order."""
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = (dp[i + 1][j + 1] + 1 if a[i] == b[j]
                        else max(dp[i + 1][j], dp[i][j + 1]))
    keys, i, j = set(), 0, 0
    while i < n and j < m:
        if a[i] == b[j]:
            keys.add(a[i])
            i, j = i + 1, j + 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return keys


def _stretch_at(run, i, keys) -> int:
    """How many steps from run[i] on read exactly `keys` (a merged step's
    keys flattened in place), or 0."""
    k, j = 0, i
    while k < len(keys):
        if j >= len(run):
            return 0
        step_keys = _step_keys(run[j])
        if not step_keys:
            return 0
        for key in step_keys:
            if k >= len(keys) or key != keys[k]:
                return 0
            k += 1
        j += 1
    return j - i


def _collapse_merged(pattern_steps, run_steps) -> list:
    """The run's steps, with every stretch of at least two consecutive steps
    whose draft keys, read in order, are exactly the draft_keys of a merged
    pattern step folded into one unit carrying that step's name and
    draft_keys, so it matches the merge (two drafts in a run match the
    pattern's merge of the same two drafts). At each position the merged
    pattern step with the most keys wins; among equals, the first one. The
    same rule as viewer/run-differences.js collapseToReference. A folded unit
    keeps the run's steps it stands for under `members` (their times and
    fields); the rule does not read them."""
    targets = []
    for step in pattern_steps:
        dk = step.get("draft_key") if isinstance(step, dict) else None
        if not isinstance(step, dict) or (isinstance(dk, str) and dk):
            continue
        keys = _key_list(step.get("draft_keys"))
        if keys and len(keys) >= 2:
            targets.append((keys, step))
    if not targets:
        return list(run_steps)
    out, i = [], 0
    while i < len(run_steps):
        best, best_len = None, 0
        for keys, step in targets:
            if best is not None and len(keys) <= len(best[0]):
                continue
            n = _stretch_at(run_steps, i, keys)
            if n >= 2:
                best, best_len = (keys, step), n
        if best is not None:
            members = list(run_steps[i:i + best_len])
            out.append({"name": best[1].get("name"), "draft_keys": list(best[0]),
                        "case_id": members[0].get("case_id") if isinstance(members[0], dict) else None,
                        "members": members})
            i += best_len
        else:
            out.append(run_steps[i])
            i += 1
    return out


# The stretches of one run left out of the analysis: step_flow's rule, the
# one viewer/run-differences.js leftOutStretches follows (pinned together by
# shared/run-differences-golden.json). The map cuts its traces at them too.
_left_out_stretches = left_out_stretches


def _left_out_text(stretches, origin, unit="run") -> str:
    """The one line a run with stretches left out says: "Part of this run was
    left out of the analysis (1:10 to 1:45)." with the times since the
    recording started (`origin`), several stretches joined "a, b and c", no
    times when the start is not known or a time falls before it; "" for no
    stretch. viewer/run-differences.js leftOutText, pinned with it."""
    if not stretches:
        return ""
    spans = []
    for s, e in stretches:
        a = clock((s - origin).total_seconds() * 1000) if origin is not None else ""
        b = clock((e - origin).total_seconds() * 1000) if origin is not None else ""
        spans.append((a, b))
    times = (" (" + _joined(f"{a} to {b}" for a, b in spans) + ")"
             if all(a and b for a, b in spans) else "")
    return f"Part of this {unit} was left out of the analysis{times}."


def _inside_stretches(units, ref_index, ref_length, stretches) -> set:
    """The indexes in the pattern run of the steps inside the stretches left
    out: a stretch falls between the run's units (a unit is before it when it
    starts before the stretch starts; a unit without a time is after), and
    the pattern steps after the pattern position of the nearest unit before
    it the pattern has, and before that of the nearest such unit after it
    (the pattern's start and end when there is none), are inside. No Skipped
    line is written for them (viewer/run-differences.js, the same rule)."""
    inside: set = set()
    for s, _e in stretches:
        at = sum(1 for u in units
                 if (t := step_start(_members(u)[0])) is not None and t < s)
        lo, hi = -1, ref_length
        for i in range(at - 1, -1, -1):
            key = _align_key(units[i])
            if key in ref_index:
                lo = ref_index[key]
                break
        for i in range(at, len(units)):
            key = _align_key(units[i])
            if key in ref_index:
                hi = ref_index[key]
                break
        inside.update(range(lo + 1, hi))
    return inside


# The kinds of difference lines that are differences: the Steps level counts
# them in a transaction's head, and the Checklist names a transaction that
# has one. A stretch left out ("left_out") and a conditional step not done
# ("not_done") are said, and are no difference.
COUNTED_KINDS = ("extra", "order", "skipped", "repeated")


def _condition_of_key(steps, key) -> str:
    """The condition (C17 `only_when`, one line) of the first of `steps`
    with the align key `key` that carries one, or ""."""
    for step in steps:
        if isinstance(step, dict) and _align_key(step) == key:
            cond = condition_of(step)
            if cond:
                return cond
    return ""


def _difference_items(pattern_steps, run_steps, left_out=None) -> list[dict]:
    """The differences of a run from the pattern run, one dict each: {"kind",
    "key", "step", "prev", "index", "condition", "times"}, kind one of
      "extra"     a step of the run the pattern lacks (`prev`: the unit
                  before it, None at the start of the run);
      "order"     a step both have, outside a longest common order;
      "skipped"   a pattern step the run lacks (`index`: its place in the
                  pattern run);
      "not_done"  a pattern step the run lacks that happens only under a
                  condition (C17 `only_when`, `condition`): not a difference;
      "repeated"  a step the run does more often than the pattern run, at
                  least twice (`times`: how often), at its first time;
    in that order: extra and order in the run's order, then skipped and
    not_done in the pattern's order, then repeated in the run's order. Steps
    are matched by their align key, after the run's stretches that spell a
    merged pattern step are folded (_collapse_merged). `left_out`: the run's
    stretches left out of the analysis (_left_out_stretches); the pattern
    steps inside them are neither skipped nor not done (_inside_stretches).
    viewer/run-differences.js differences, pinned with it by
    shared/run-differences-golden.json."""
    units = _collapse_merged(pattern_steps, run_steps)
    pat, run = _first_occurrences(pattern_steps), _first_occurrences(units)
    pat_keys, run_keys = [k for k, _s, _i in pat], [k for k, _s, _i in run]
    in_order = _common_order(pat_keys, run_keys)
    inside = (_inside_stretches(units, {k: i for k, _s, i in pat}, len(pattern_steps), left_out)
              if left_out else set())
    pat_count = Counter(_align_key(st) for st in pattern_steps)
    run_count = Counter(_align_key(u) for u in units)

    def item(kind, key, step, prev=None, index=None, condition="", times=0):
        return {"kind": kind, "key": key, "step": step, "prev": prev, "index": index,
                "condition": condition, "times": times}

    items = []
    for key, step, i in run:
        prev = units[i - 1] if i else None
        if key not in pat_keys:
            items.append(item("extra", key, step, prev))
        elif key not in in_order:
            items.append(item("order", key, step, prev))
    for key, step, i in pat:
        if key in run_keys or i in inside:
            continue
        condition = _condition_of_key(pattern_steps, key)
        items.append(item("not_done", key, step, index=i, condition=condition) if condition
                     else item("skipped", key, step, index=i))
    for key, step, _i in run:
        n = run_count[key]
        if n >= 2 and n > pat_count.get(key, 0):
            items.append(item("repeated", key, step, times=n))
    return items


def difference_count(pattern_steps, run_steps, left_out=None) -> int:
    """How many differences a run has from the pattern run: its difference
    items of the COUNTED_KINDS (viewer/run-differences.js differenceCount)."""
    return sum(1 for it in _difference_items(pattern_steps, run_steps, left_out)
               if it["kind"] in COUNTED_KINDS)


def _clause(condition: str) -> str:
    """An analyst's condition inside a sentence: no full stop at its end."""
    return condition.rstrip().rstrip(".").rstrip()


def _differences(pattern_steps, run_steps, left_out=None, origin=None) -> list[str]:
    """One line per difference of a run from the pattern run (_difference_items),
    after the one line on its stretches left out (_left_out_text) when it has
    any: the viewer's differences review (viewer/run-differences.js) builds the
    same lines; both are pinned by shared/run-differences-golden.json, so
    their wording changes only together with the viewer's and the golden's.
    The document words the same items for its reader (_variation_lines)."""
    out = [_left_out_text(left_out, origin)] if left_out else []
    for it in _difference_items(pattern_steps, run_steps, left_out):
        kind, step, prev = it["kind"], it["step"], it["prev"]
        where = f"after {_step_name(prev)}" if prev is not None else "at the start of the run"
        if kind == "extra":
            out.append(f"Extra step: {_step_name(step)} ({where}).")
        elif kind == "order":
            out.append(f"Different order: {_step_name(step)} (in this run {where}).")
        elif kind == "skipped":
            out.append(f"Skipped: {_step_name(step)} (step {it['index'] + 1} of the pattern run).")
        elif kind == "not_done":
            out.append(f"Not done: {_step_name(step)} (only when {_clause(it['condition'])}).")
        else:
            out.append(f"Repeated: {_step_name(step)}, {it['times']} times.")
    return out


def _variation_lines(s, run_index) -> list[str]:
    """The document's lines for one run: first, once, the part of it left
    out of the analysis (annotations.excluded_ranges, cut to its span), then
    its differences from the reference transaction (_difference_items, the
    rule the Steps level follows): each extra step with its system, in how
    many transactions it happened and what was done; each step in another
    order; each skipped step with how many transactions did it; a step that
    happens only under a condition the transaction did not do, with the
    condition (no difference); each step it did more often than the
    reference transaction, with how often. A reference step inside a stretch
    left out is neither skipped nor not done. The reference transaction is
    compared with nothing: it says only its stretches left out."""
    m = len(s.runs)
    stretches = s.left_out(run_index)
    lines = [_left_out_text(stretches, s.recording_start, "transaction")] if stretches else []
    if run_index == s.pattern_index:
        return lines
    pattern = s.run_steps(s.pattern_index)
    for it in _difference_items(pattern, s.run_steps(run_index), stretches):
        kind, key, step, prev = it["kind"], it["key"], it["step"], it["prev"]
        name = _step_name(step)
        if kind == "extra":
            where = (f" after {_step_name(prev)}" if prev is not None
                     else " at the start of the transaction")
            system = s.system_of(step)
            shown = f"{name} ({system})" if system and system.lower() not in name.lower() else name
            line = (f"Extra step{where}: {shown}, in {s.key_runs.get(key) or 1} "
                    f"of {m} transactions.")
            done = s.what_was_done(step)
            lines.append(f"{line} {done}" if done else line)
        elif kind == "order":
            after = f"after {_step_name(prev)}" if prev is not None else "first"
            lines.append(f"Different order: {name}, done {after} in this transaction.")
        elif kind == "skipped":
            lines.append(f"Skipped: {name} (done in {s.key_runs.get(key) or 0} "
                         f"of {m} transactions).")
        elif kind == "not_done":
            lines.append(f"Not done: {name} (only when {_clause(it['condition'])}).")
        else:
            lines.append(f"Repeated: {name}, {it['times']} times.")
    return lines


def _write_variations(doc, s):
    doc.add_heading("4. Variations, rules and exceptions", level=1)
    doc.add_heading("4.1 Differences between transactions", level=2)
    if not s.runs:
        doc.add_paragraph("Transactions were not marked in this recording, so there "
                          "are no transactions to compare.")
    elif s.implicit:
        # C16: one implicit run covers the session: nothing to compare.
        doc.add_paragraph(f"{_IMPLICIT}, so there are no transactions to compare.")
    elif s.pattern_index is None:
        doc.add_paragraph("None of the recorded transactions has steps, so the "
                          "transactions cannot be compared.")
    else:
        same = []
        for i in range(len(s.runs)):
            lines = _variation_lines(s, i)
            if not lines:
                if i != s.pattern_index:
                    same.append(s.run_label(i))
                continue
            label = s.run_label(i) + (" (the reference transaction)"
                                      if i == s.pattern_index else "")
            doc.add_paragraph().add_run(label).bold = True
            for line in lines:
                doc.add_paragraph(line, style="List Bullet")
        if len(s.runs) == 1:
            doc.add_paragraph("Only one transaction was recorded.")
        elif same:
            doc.add_paragraph(f"No differences from the reference transaction: {_joined(same)}.")
    doc.add_heading("4.2 Business rules", level=2)
    _field_or_placeholder(doc, s.field("business_rules"),
                          "the business rules the process follows")
    doc.add_heading("4.3 Exceptions", level=2)
    _field_or_placeholder(doc, s.field("exceptions"),
                          "the business exceptions and the application errors "
                          "that can interrupt the process, and how each one is handled")


# ---- 5. Data ------------------------------------------------------------------

def _rekey_value(data, value) -> str:
    """The value as re-keying compares it, or "" when it does not count: a
    secret, a noise literal, or shorter than the re-key minimum
    (REKEY_MIN_LEN; a vocabulary that vouches for the field lowers it)."""
    if not isinstance(data, dict) or data.get("kind") not in _TYPED_KINDS:
        return ""
    if data.get("value_redacted") is True or value.lower() in _NOISE_VALUES:
        return ""
    vouched = (data.get("vocab_semantics") or {}).get("carries_value") is True
    return value if len(value) >= (REKEY_MIN_LEN_VOCAB if vouched else REKEY_MIN_LEN) else ""


def rekey_pairs(s) -> list[tuple[tuple[str, str], tuple[str, str], int, list[str]]]:
    """Re-keyed data: ((field, system) first typed, (field, system) typed
    again, runs, values) for every value typed into a field in one system
    and typed again into a field of another system in the same run, counted
    over the runs, most frequent first. `values` are the values so typed
    again, each once, in the order met (the Technical details' example
    values, contract C20; the PDD prints the pairs, _rekeyed)."""
    counts: Counter = Counter()
    order: dict = {}
    values: dict = {}
    for units in s.units:
        entries = []
        for unit in units:
            for field, value, data, ts, member in s.entries(unit):
                v = _rekey_value(data, value)
                if v:
                    system = s.entry_where(member, data)[0]
                    entries.append((ts, field, system, v))
        first: dict[str, tuple[str, str]] = {}
        pairs = set()
        for _ts, field, system, v in sorted(entries, key=lambda e: _time_key(e[0])):
            if v not in first:
                first[v] = (field, system)
            elif system and system != first[v][1]:
                pair = (first[v], (field, system))
                pairs.add(pair)
                values.setdefault(pair, {}).setdefault(v, None)
        for pair in pairs:
            counts[pair] += 1
            order.setdefault(pair, len(order))
    return [(a, b, n, list(values.get((a, b), {})))
            for (a, b), n in sorted(counts.items(), key=lambda kv: (-kv[1], order[kv[0]]))]


def _rekeyed(s) -> list[tuple[tuple[str, str], tuple[str, str], int]]:
    """The re-keyed pairs the PDD prints (rekey_pairs without the values)."""
    return [(a, b, n) for a, b, n, _values in rekey_pairs(s)]


def _rekey_sentence(src, dst, n, runs) -> str:
    often = "in every transaction" if n >= runs else f"in {n} of {runs} transactions"
    if src[0] == dst[0]:
        return f"{src[0]} is typed in {src[1]} and again in {dst[1]} {often}."
    return f"{src[0]} ({src[1]}) is typed again as {dst[0]} ({dst[1]}) {often}."


# The rows sections 5 and 6 print are computed once, as plain data
# (data_section, time_section), and printed from that data: the pipeline
# writes the same data into analysis.json (`pdd_data`, `pdd_time`, through
# pdd_rows), and the viewer's Overview shows it, so the Overview and the PDD
# say one fact in the same words (shared/pdd-rows-golden.json pins it).

DATA_HEADER = ("Field", "System and screen", "Step", "Example value", "Re-keyed")
_DATA_WIDTHS = (1.15, 1.35, 1.35, 1.15, 1.0)


def data_section(s) -> dict:
    """Section 5, Data, as the document prints it: {"heading": "Data",
    "note": a sentence printed in place of the table (no field entries, or
    none available to the export) or None, "header": the table's columns,
    "rows": one row per distinct field entered across the process (field,
    its system and screen, its step, an example value, how it is re-keyed:
    the reference run's first, then what only the other runs and the steps
    outside the runs entered), "rekeyed": one sentence per re-keying (a value
    typed in one system and again in another in the same transaction), most
    frequent first}."""
    out = {"heading": "Data", "note": None, "header": list(DATA_HEADER), "rows": [], "rekeyed": []}
    if not s.have_events:
        out["note"] = "The recorded field entries were not available to this export."
        return out
    outside = s.steps_by_run.get(None, []) if s.runs else s.steps
    rows, seen = [], set()
    for unit in s.run_units() + outside:
        for field, value, data, _ts, member in s.entries(unit):
            key = (field, _align_key(unit))
            if key in seen:
                continue
            seen.add(key)
            system, screen = s.entry_where(member, data)
            rows.append([field, ", ".join(x for x in (system, screen) if x),
                         _step_name(unit), value, system])
    if not rows:
        out["note"] = "No field entries were recorded in the steps of this process."
        return out
    rekeys = _rekeyed(s)
    marks: dict[tuple[str, str], list[str]] = {}
    for src, dst, _n in rekeys:
        marks.setdefault(src, []).append(f"as {dst[0]} ({dst[1]})")
        marks.setdefault(dst, []).append(f"from {src[0]} ({src[1]})")
    out["rows"] = [[f, where, step, value, "; ".join(marks.get((f, system), []))]
                   for f, where, step, value, system in rows]
    out["rekeyed"] = [_rekey_sentence(src, dst, n, len(s.runs) or 1) for src, dst, n in rekeys]
    return out


def _write_data(doc, s):
    """5: the distinct fields entered across the process, each with its
    system and screen and its step; re-keyed fields are marked, and each
    re-keying is stated below the table (data_section)."""
    d = data_section(s)
    doc.add_heading("5. " + d["heading"], level=1)
    if d["note"]:
        doc.add_paragraph(d["note"])
        return
    _table(doc, d["header"], d["rows"], widths=_DATA_WIDTHS)
    if d["rekeyed"]:
        doc.add_paragraph().add_run("Re-keyed data").bold = True
        for sentence in d["rekeyed"]:
            doc.add_paragraph(sentence, style="List Bullet")


# ---- 6. Applications and time -------------------------------------------------

def time_section(s) -> dict:
    """Section 6, Applications and time, as the document prints it:
    {"heading": "Applications and time",
     "per_transaction": {"heading": "Time per transaction", "note": the
       sentence printed in place of the table when the transactions are not
       marked (else None), "header", "rows": one row per transaction (its
       name, its steps, its active and elapsed time), "after": the line under
       the table (the times are a walkthrough's) or None},
     "per_application": {"heading": "Time in each application", "note": the
       sentence printed when there is no step (else None), "header" (the
       time column only when a step has a time: "Time per transaction", or
       "Time" without marked transactions), "rows": one row per system (its
       screens, its steps, its time per transaction), the most time first}}.
    Every cell is the text printed."""
    per_tx = {"heading": "Time per transaction", "note": None,
              "header": ["Transaction", "Steps", "Active time", "Elapsed time"], "rows": [], "after": None}
    if not s.runs:
        per_tx["note"] = ("Transactions were not marked in this recording, so there "
                          "is no time per transaction.")
    elif s.implicit:
        per_tx["note"] = f"{_IMPLICIT}, so there is no time per transaction."
    else:
        for i, run in enumerate(s.runs):
            wall, active = run.get("wall_clock_ms"), run.get("active_ms")
            per_tx["rows"].append([s.run_label(i), str(len(s.run_steps(i))),
                                   # C16: a session without a recording measured no active time.
                                   "Not recorded" if active is None else _fmt_ms(active),
                                   _fmt_ms(wall) if _num(wall)
                                   else "Not measured: the transaction was not ended"])
        # AD-28: the transactions are a walkthrough, not the day-to-day work.
        per_tx["after"] = _WALKTHROUGH
    per_app = {"heading": "Time in each application", "note": None,
               "header": ["System", "Screens", "Steps"], "rows": []}
    units = s.run_units() if s.runs else s.steps
    per: dict[str, dict] = {}
    for unit in units:
        system = s.system_of(unit) or NO_SYSTEM
        row = per.setdefault(system, {"screens": {}, "steps": {}, "ms": 0.0, "timed": False})
        screen = s.ctx.where(_members(unit)[0])[1]
        if screen:
            row["screens"].setdefault(screen, None)
        row["steps"].setdefault(_align_key(unit), _step_name(unit))
        ms = _unit_ms(unit)
        if ms is not None:          # C16: a step without a time adds no time
            row["ms"] += ms
            row["timed"] = True
    if not per:
        per_app["note"] = ("No steps have been added to this project yet." if not s.recorded
                           else "No steps have been recorded for this project yet.")
    else:
        runs = len(s.runs)

        def time_of(row):
            if not row["timed"]:
                return "Not measured"
            return _duration(row["ms"] / runs) if runs else _duration(row["ms"])

        ordered = sorted(per.items(), key=lambda kv: -kv[1]["ms"])
        rows = [[system, ", ".join(row["screens"]),
                 ", ".join(row["steps"].values())] for system, row in ordered]
        if any(row["timed"] for row in per.values()):
            per_app["header"].append("Time per transaction" if runs and not s.implicit else "Time")
            rows = [r + [time_of(row)] for r, (_system, row) in zip(rows, ordered)]
        # else: no step has a time (C16), and the table leaves the time out.
        per_app["rows"] = rows
    return {"heading": "Applications and time", "per_transaction": per_tx, "per_application": per_app}


def _write_applications_and_time(doc, s):
    """6: the time of every transaction (6.1) and each system's screens,
    steps and time per transaction (6.2), from time_section."""
    t = time_section(s)
    doc.add_heading("6. " + t["heading"], level=1)
    tx = t["per_transaction"]
    doc.add_heading("6.1 " + tx["heading"], level=2)
    if tx["note"]:
        doc.add_paragraph(tx["note"])
    else:
        _table(doc, tx["header"], tx["rows"], widths=(2.4, 0.8, 1.4, 1.4))
        if tx["after"]:
            doc.add_paragraph(tx["after"])
    app = t["per_application"]
    doc.add_heading("6.2 " + app["heading"], level=2)
    if app["note"]:
        doc.add_paragraph(app["note"])
        return
    _table(doc, app["header"], app["rows"],
           widths=(1.1, 1.6, 2.4, 0.9) if len(app["header"]) == 4 else (1.3, 1.8, 2.9))


def pdd_rows(*, session_folder, annotations, stats, manifest, events) -> dict:
    """What the PDD prints in sections 5 and 6, as the pipeline writes it into
    analysis.json: {"pdd_data": data_section, "pdd_time": time_section}, for
    the same inputs write_pdd reads (the derived event stream, the steps,
    stats.json and the manifest), so the Overview and the PDD print one set of
    rows. Needs no python-docx."""
    s = _Session(session_folder, annotations, stats, manifest, events)
    return {"pdd_data": data_section(s), "pdd_time": time_section(s)}


# ---- 7. Improvement and automation scope, 8. Notes ---------------------------------

def _write_improvement(doc, s, tobe_map_image, notes_follow):
    doc.add_heading("7. Improvement and automation scope", level=1)
    _field_or_placeholder(doc, s.field("improvement"),
                          "what to improve or automate, what stays manual, and why")
    _map_page(doc, s, tobe_map_image, "7.1 To-Be process map", "To-Be process map",
              "Proposed To-Be process, drawn by the analyst.", then_portrait=notes_follow)


def _write_notes(doc, s):
    """8: the analyst's notes (C6 `document.notes`), after the improvement
    scope. An empty field adds nothing, no heading and no placeholder: notes
    are optional, so their absence is not a gap in the document. The notes
    the analyst pins to steps and moments (annotations.analyst_notes, C16)
    are context in the viewer and are not printed."""
    notes = s.field("notes")
    if not notes:
        return
    doc.add_heading("8. Notes", level=1)
    _text(doc, notes)


def _write_attachments(doc, s, number):
    """The last section, only when the analyst attached files (contract
    C16, annotations.attachments): each attachment's label and file name.
    Nothing is embedded; the files stay in the session folder's
    attachments/ folder. A step's attachments are also named under that
    step (_write_step)."""
    if not s.attachments:
        return
    doc.add_heading(f"{number}. Attachments", level=1)
    doc.add_paragraph("The files are in the project folder's attachments folder.")
    _table(doc, ("Attachment", "File"),
           [(_attachment_label(a), _file_name(a.get("file"))) for a in s.attachments],
           widths=(3.0, 3.0))
