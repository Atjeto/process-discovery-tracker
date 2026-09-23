"""Generate the Process Definition Document (.docx) from a normalized session.

The PDD is the analyst's deliverable, written for any automation technology
or application work, so its wording is tool-neutral. It is built around:

  * the PATTERN RUN (annotations.pattern_run, contract C3): the run the
    analyst confirmed as the reference; its steps, in time order, are the
    detailed process description (4.5);
  * the analyst's document sections (annotations.document, contract C6):
    title, purpose, scope, contacts, business rules, exceptions, and notes
    (a last section 7, only when written);
  * the measured timings of every run, in one table (4.4);
  * the differences between the runs, each aligned to the pattern run (6.1).

Section 1 is the findings content, rendered from memo_export's model (the
analyst's memo_selection). Every number printed is measured from the
recording or entered by the analyst; "[To be completed: ...]" placeholders
mark what the analyst still owns.

Honesty rules kept here: hidden steps never appear (RP-06); an analysis stage
that failed says it could not run on this recording (C12); a case-based
finding renders only when runs exist; applications carry readable names,
never executable tokens (app_names, DA gap 3).

Uses python-docx.
"""

from __future__ import annotations
import json
import logging
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt, Inches
except ImportError:
    Document = None
    Pt = None
    Inches = None

from _dt import parse_ts_or_none as _parse_ts
from app_names import display_name
from facts import _NOISE_VALUES
from findings import _fmt_ms as _fmt_duration
from memo_export import (COULD_NOT_RUN as _COULD_NOT_RUN, build_memo_model,
                         failed_stages, run_rows, write_memo_into_docx)
from step_suggest import _default_step_description, process_label

logger = logging.getLogger(__name__)

# Interaction kinds that put a typed value into a field.
_TYPED_KINDS = ("value_changed", "text_changed")
# A field value longer than this is cut in the document.
_VALUE_MAX = 200


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
) -> None:
    """Write the PDD to `out_path`. `events` is the derived event stream the
    entered fields (4.5, 4.6) are read from; without it those parts say the
    field entries were not available."""
    if Document is None:
        raise RuntimeError(
            "python-docx is not installed. Add `python-docx>=1.1.0` to "
            "normalization/requirements.txt and reinstall."
        )
    s = _Session(session_folder, annotations, stats, manifest, analysis, events)
    doc = Document()
    _write_title(doc, s)
    model = _write_findings(doc, s)                   # 1. Findings
    _write_document_control(doc, s)                   # 2. Document control
    _write_introduction(doc, s)                       # 3. Introduction
    doc.add_heading("4. As-is process", level=1)
    _write_overview(doc, s)                           # 4.1
    _write_applications(doc, s)                       # 4.2
    _write_process_map(doc, process_map_image)        # 4.3
    _write_timings(doc, s)                            # 4.4
    _write_steps(doc, s)                              # 4.5
    _write_input_data(doc, s)                         # 4.6
    _write_automation(doc, s, model)                  # 5.1 to 5.3
    _write_tobe_map(doc, tobe_map_image)              # 5.4
    _write_exceptions(doc, s)                         # 6.
    _write_notes(doc, s)                              # 7., only when written
    _write_footer(doc)
    doc.save(str(out_path))


# ---- the session as the document sees it -----------------------------------

def _start_key(step):
    start = (step.get("time_range") or {}).get("start")
    t = _parse_ts(start)
    return (t is None, t.timestamp() if t else 0.0, str(start or ""))


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
    process_label of its name. Pinned with the viewer by
    shared/run-differences-golden.json."""
    dk = step.get("draft_key")
    if isinstance(dk, str) and dk:
        return "draft:" + dk
    keys = _key_list(step.get("draft_keys"))
    if keys:
        return "merge:" + json.dumps(keys, ensure_ascii=False, separators=(",", ":"))
    return "label:" + process_label(str(step.get("name") or ""))


def _step_name(step) -> str:
    name = step.get("name")
    return name.strip() if isinstance(name, str) and name.strip() else "(unnamed step)"


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class _Session:
    """What every section reads, computed once: the visible steps, the runs,
    the pattern run (C3), the document fields (C6) and the entered fields."""

    def __init__(self, folder, annotations, stats, manifest, analysis, events):
        self.folder = Path(folder)
        self.annotations = annotations if isinstance(annotations, dict) else {}
        self.stats = stats if isinstance(stats, dict) else {}
        self.manifest = manifest if isinstance(manifest, dict) else {}
        self.analysis = analysis if isinstance(analysis, dict) else {}
        self.failed = failed_stages(self.analysis)
        meta = self.stats.get("meta") or {}
        self.app_names = meta.get("app_names") or {}
        config = self.manifest.get("config")
        worker = config.get("worker") if isinstance(config, dict) else None
        self.worker = str((worker if isinstance(worker, dict) else {}).get("id") or "")
        started = self.manifest.get("started_at")
        self.captured = started[:10] if isinstance(started, str) and len(started) >= 10 else ""

        # RP-06: a hidden step never reaches the document.
        self.steps = sorted((st for st in self.annotations.get("steps") or []
                             if isinstance(st, dict) and st.get("state") != "hidden"),
                            key=_start_key)
        self.runs = run_rows(self.stats)
        self.steps_by_run: dict = {}
        for st in self.steps:
            cid = st.get("case_id")
            self.steps_by_run.setdefault(cid if isinstance(cid, str) else None,
                                         []).append(st)
        self.pattern_index, self.pattern_how = self._pick_pattern()

        self.interactions = {}
        for ev in events or []:
            if (isinstance(ev, dict) and ev.get("type") == "interaction"
                    and ev.get("event_id") and isinstance(ev.get("data"), dict)):
                self.interactions[ev["event_id"]] = ev["data"]
        self.have_events = events is not None

    def _pick_pattern(self):
        """C3: the run the analyst chose, when it names a recorded run; else
        the first run (by start time) that has steps; else none."""
        chosen = self.annotations.get("pattern_run")
        cid = chosen.get("case_id") if isinstance(chosen, dict) else None
        for i, run in enumerate(self.runs):
            if cid and run["case_id"] == cid:
                return i, "chosen"
        for i, run in enumerate(self.runs):
            if self.steps_by_run.get(run["case_id"]):
                return i, "first"
        return None, None

    def field(self, key) -> str:
        doc = self.annotations.get("document")
        value = doc.get(key) if isinstance(doc, dict) else None
        return value.strip() if isinstance(value, str) else ""

    def run_label(self, index) -> str:
        label = self.runs[index].get("label")
        label = label.strip() if isinstance(label, str) else ""
        return f"Run {index + 1}: {label}" if label else f"Run {index + 1}"

    def run_steps(self, index) -> list:
        return self.steps_by_run.get(self.runs[index]["case_id"], [])

    def drafted_description(self, step) -> str | None:
        """The narration the drafting writes for this step's interactions,
        recomputed with the same function (step_suggest's
        _default_step_description), or None when it cannot be recomputed: no
        events given to the export, a step without interactions, or an
        interaction missing from the events."""
        ids = (step.get("evidence") or {}).get("interaction_event_ids") or []
        datas = [self.interactions.get(eid) for eid in ids]
        if not self.have_events or not ids or any(d is None for d in datas):
            return None
        return _default_step_description([{"data": d} for d in datas])

    def fields_of(self, step) -> list[tuple[str, str]]:
        """The (field, value) pairs entered in this step, in the order first
        entered; a field entered twice keeps its last value."""
        out: dict[str, str] = {}
        for eid in (step.get("evidence") or {}).get("interaction_event_ids") or []:
            got = _entered(self.interactions.get(eid))
            if got:
                out[got[0]] = got[1]
        return list(out.items())

    def applications(self) -> list[tuple[str, int]]:
        """(readable name, interactions recorded), most used first."""
        counts: Counter[str] = Counter()
        cov = (self.stats.get("meta") or {}).get("vocab_coverage") or {}
        if isinstance(cov, dict) and cov:
            for proc, info in cov.items():
                n = (info or {}).get("total_interactions") if isinstance(info, dict) else 0
                counts[display_name(proc, self.app_names)] += n if _num(n) else 0
        else:
            for data in self.interactions.values():
                proc = data.get("process_name")
                if isinstance(proc, str) and proc.strip():
                    counts[display_name(proc, self.app_names)] += 1
        return [(name, n) for name, n in counts.most_common() if name]


def _entered(data) -> tuple[str, str] | None:
    """(field, value) when this interaction entered a value into a field."""
    if not isinstance(data, dict):
        return None
    kind = data.get("kind")
    if kind in _TYPED_KINDS:
        if data.get("value_redacted") is True:
            value = "(not recorded: secret field)"
        else:
            raw = data.get("value")
            value = raw.strip() if isinstance(raw, str) else ""
            if not value or value.lower() in _NOISE_VALUES:
                return None
    elif kind == "selection_changed" and data.get("control_type") not in ("TabItem", "Tab"):
        raw = data.get("selected_value")
        value = raw.strip() if isinstance(raw, str) else ""
        if not value:
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

def _placeholder(doc, text):
    """An italic, clearly-marked gap for the analyst to complete."""
    p = doc.add_paragraph()
    p.add_run(f"[To be completed: {text}]").italic = True
    return p


def _note(doc, text):
    """A small italic caption (bases, disclaimers, table footnotes)."""
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = True
    if Pt is not None:
        run.font.size = Pt(9)
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


def _table(doc, header, rows):
    t = doc.add_table(rows=1, cols=len(header))
    for cell, text in zip(t.rows[0].cells, header):
        cell.text = text
    for row in rows:
        for cell, text in zip(t.add_row().cells, row):
            cell.text = str(text)
    return t


def _kv_table(doc, rows):
    t = doc.add_table(rows=0, cols=2)
    for k, v in rows:
        c = t.add_row().cells
        c[0].text = str(k)
        c[1].text = str(v)
    return t


def _plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def _joined(items):
    items = [str(i) for i in items]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


# ---- title, 1. Findings, 2. Document control, 3. Introduction ---------------

def _write_title(doc, s):
    title = s.field("title")
    if title:
        doc.add_heading(title, level=0)
        doc.add_paragraph("Process Definition Document", style="Subtitle")
    else:
        doc.add_heading("Process Definition Document", level=0)


def _write_findings(doc, s):
    """1 = the findings content, rendered from build_memo_model(): one source
    of truth for each claim, number, and the analyst's selection."""
    doc.add_heading("1. Findings", level=1)
    model = build_memo_model(s.manifest, s.stats, s.analysis, s.annotations)
    _note(doc, f"Captured {model['captured']} · {model['coverage_line']}")
    write_memo_into_docx(doc, model, session_folder=s.folder, heading_offset=1)
    _note(doc, "Every number above was measured from the recording; the "
               "sentences are templated. The sections below document the "
               "process in full.")
    return model


def _write_document_control(doc, s):
    doc.add_heading("2. Document control", level=1)
    _kv_table(doc, [
        ("Process", s.field("title") or "Not named yet"),
        ("Engagement", s.manifest.get("engagement_id") or "Not recorded"),
        ("Source recording", s.manifest.get("session_id") or "Not recorded"),
        ("Recorded by", s.worker or "Not recorded"),
        ("Captured", s.captured or "Not recorded"),
        ("Runs recorded", str(len(s.runs))),
        ("Document generated", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        ("Version", "Draft"),
    ])


def _write_introduction(doc, s):
    doc.add_heading("3. Introduction", level=1)
    doc.add_heading("3.1 Purpose", level=2)
    _field_or_placeholder(doc, s.field("purpose"),
                          "the business need this process serves and why it "
                          "is being documented")
    doc.add_heading("3.2 Scope", level=2)
    _field_or_placeholder(doc, s.field("scope"),
                          "where the process starts and ends, and what it covers")
    doc.add_heading("3.3 Key contacts", level=2)
    if s.worker:
        _table(doc, ("Name", "Role", "Contact"),
               [(s.worker, "Process operator (recorded)", "Not recorded")])
    _field_or_placeholder(doc, s.field("contacts"),
                          "the process owner, the subject-matter expert and "
                          "the analyst")


# ---- 4.1 Overview -----------------------------------------------------------

def _write_overview(doc, s):
    doc.add_heading("4.1 Overview", level=2)
    apps = [name for name, _n in s.applications()]
    lead = "This process was recorded"
    if s.captured:
        lead += f" on {s.captured}"
    if s.worker:
        lead += f" by {s.worker}"
    lead += f": {_plural(len(s.runs), 'run')}" if s.runs else ": no runs were marked"
    if apps:
        lead += f", in {_plural(len(apps), 'application')} ({', '.join(apps)})"
    doc.add_paragraph(lead + ".")

    walls = [r["wall_clock_ms"] for r in s.runs if _num(r.get("wall_clock_ms"))]
    if len(walls) >= 2:
        doc.add_paragraph(
            f"Each run took between {_fmt_ms(min(walls))} and {_fmt_ms(max(walls))} "
            f"of elapsed time (mean {_fmt_ms(sum(walls) / len(walls))}); "
            "section 4.4 has the timings of every run.")
    elif walls:
        doc.add_paragraph(f"The run took {_fmt_ms(walls[0])} of elapsed time; "
                          "section 4.4 has its timings.")

    meta = s.stats.get("meta") or {}
    sb = meta.get("step_state_breakdown")
    if isinstance(sb, dict) and _num(meta.get("step_count")):
        parts = [f"{sb.get(key)} {word}" for key, word in (
            ("confirmed", "confirmed"), ("edited", "edited by the analyst"),
            ("manually_authored", "added by the analyst"),
            ("auto_suggested", "drafted and not yet confirmed"))
            if _num(sb.get(key)) and sb.get(key) > 0]
        line = f"Steps: {meta['step_count']} in total"
        if parts:
            line += f" ({', '.join(parts)})"
        hidden = sb.get("hidden")
        if _num(hidden) and hidden > 0:
            line += (f"; {hidden} hidden by the analyst and left out of this "
                     "document")
        doc.add_paragraph(line + ".")
    _placeholder(doc, "a short business description of what the process does "
                      "and the outcome it produces")


# ---- 4.2 Applications used ---------------------------------------------------

def _write_applications(doc, s):
    doc.add_heading("4.2 Applications used", level=2)
    apps = s.applications()
    if not apps:
        _placeholder(doc, "the applications this process touches")
        return
    _table(doc, ("Application", "Interactions recorded", "Role in process"),
           [(name, n, "") for name, n in apps])
    _note(doc, "The role each application plays is to be completed by the analyst.")


# ---- 4.3 As-is process map ---------------------------------------------------

def _write_process_map(doc, process_map_image):
    doc.add_heading("4.3 As-is process map", level=2)
    if process_map_image and Path(process_map_image).exists() and Inches is not None:
        try:
            doc.add_picture(str(process_map_image), width=Inches(6.0))
            _note(doc, "The As-is process map, as exported from the viewer.")
            return
        except (FileNotFoundError, OSError, ValueError) as exc:
            logger.warning("pdd_export: could not embed process map %s: %s",
                           process_map_image, exc)
    doc.add_paragraph("The process map is available in the viewer; the "
                      "rendered diagram is not embedded in this document.")


# ---- 4.4 Measured timings ------------------------------------------------------

def _has_bnva_override(annotations) -> bool:
    """Has the analyst judged business-required time anywhere? The same gate
    the viewer applies to the efficiency ratio (lab-phase §A5/§B3): while
    every step's bnva_ms sits at the heuristic default of 0, the ratio is an
    artifact of that default."""
    ann = annotations if isinstance(annotations, dict) else {}
    ovs = ann.get("analysis_overrides")
    if not isinstance(ovs, list):
        return False
    return any(
        isinstance(ov, dict) and ov.get("bnva_ms") is not None for ov in ovs)


def _write_timings(doc, s):
    """4.4: ONE table, one row per run (DA gap 5), each column's basis stated
    once (DA gap 7); below it count, mean, minimum and maximum, never a
    median or a percentile (DA gap 6)."""
    doc.add_heading("4.4 Measured timings", level=2)
    if not s.runs:
        line = "Runs were not marked in this recording, so there are no per-run timings."
        facts = s.analysis.get("facts")
        if (isinstance(facts, dict) and "facts" not in s.failed
                and facts.get("app_time_source") == "activity"
                and _num(facts.get("active_ms")) and _num(facts.get("session_span_ms"))):
            line += (f" The recording as a whole: {_fmt_ms(facts['active_ms'])} of "
                     f"active time over a {_fmt_ms(facts['session_span_ms'])} span.")
        doc.add_paragraph(line)
    else:
        rows = []
        for i, run in enumerate(s.runs):
            wall = run.get("wall_clock_ms")
            rows.append((s.run_label(i), len(s.run_steps(i)),
                         _fmt_ms(run.get("active_ms")),
                         _fmt_ms(wall) if _num(wall) else "Not measured (no end marker)"))
        _table(doc, ("Run", "Steps", "Active time", "Elapsed time (wall clock)"), rows)
        _note(doc, "Active time is the time an application window was in the "
                   "foreground during the run, minus the idle time the recorder "
                   "measured. Elapsed time is the wall-clock time from the run's "
                   "start marker to its end marker.")
        for label, key in (("Active time", "active_ms"),
                           ("Elapsed time", "wall_clock_ms")):
            vals = [r[key] for r in s.runs if _num(r.get(key))]
            if len(vals) >= 2:
                doc.add_paragraph(
                    f"{label} over {len(vals)} runs: mean {_fmt_ms(sum(vals) / len(vals))}, "
                    f"minimum {_fmt_ms(min(vals))}, maximum {_fmt_ms(max(vals))}.")
    efficiency = s.analysis.get("efficiency") or {}
    if "efficiency" in s.failed:
        _note(doc, f"The process-efficiency check {_COULD_NOT_RUN}.")
    elif (efficiency.get("process_efficiency_ratio") is not None
          and _has_bnva_override(s.annotations)):
        doc.add_paragraph(
            f"Value-add share: {round(efficiency['process_efficiency_ratio'] * 100)}% "
            "of the measured step time, after the analyst judged which time "
            "adds value.")


# ---- 4.5 Detailed process steps ---------------------------------------------

def _write_steps(doc, s):
    doc.add_heading("4.5 Detailed process steps", level=2)
    if s.pattern_index is None:
        steps = s.steps
        if steps:
            why = ("Runs were not marked in this recording" if not s.runs
                   else "None of the recorded runs has steps")
            _note(doc, f"{why}, so there is no pattern run; every step is "
                       "listed in time order.")
    else:
        steps = s.run_steps(s.pattern_index)
        how = ("the analyst chose it as the pattern" if s.pattern_how == "chosen"
               else "no run has been chosen as the pattern yet, so the first "
                    "run with steps is used")
        doc.add_paragraph(f"The steps below are those of "
                          f"{s.run_label(s.pattern_index)}, the pattern run: {how}.")
        drafts = sum(1 for st in steps if st.get("state") == "auto_suggested")
        if steps and not drafts:
            doc.add_paragraph(f"All {_plural(len(steps), 'step')} of this run are "
                              "confirmed by the analyst.")
        elif steps:
            doc.add_paragraph(f"{drafts} of its {_plural(len(steps), 'step')} "
                              f"{'is a draft' if drafts == 1 else 'are drafts'} "
                              "the analyst has not confirmed yet.")
    if not steps:
        doc.add_paragraph("No steps have been recorded for this run yet."
                          if s.pattern_index is not None
                          else "No steps have been recorded for this session yet.")
        return
    for number, step in enumerate(steps, start=1):
        _write_step(doc, s, step, number)


def _write_step(doc, s, step, number):
    doc.add_heading(f"{number}. {_step_name(step)}", level=3)
    desc = step.get("description")
    if isinstance(desc, str) and desc.strip():
        # A description is shown when the analyst wrote it (C7). A draft's
        # description is the drafting's generated narration of its
        # interactions; the fields table and the screenshots below already
        # carry that, so a description that still equals it is left out.
        drafted = s.drafted_description(step)
        if drafted is None or desc.strip() != drafted.strip():
            _text(doc, desc)
    fields = s.fields_of(step)
    if fields:
        doc.add_paragraph("Fields entered in this run:")
        _table(doc, ("Field", "Value entered"), fields)
    for ref in (step.get("evidence") or {}).get("screenshot_refs") or []:
        _embed_screenshot(doc, s.folder, ref, step)
    if (step.get("flags") or {}).get("waste") is True:
        p = doc.add_paragraph("Flagged as waste.")
        for run in p.runs:
            run.italic = True


def _embed_screenshot(doc, folder, ref, step):
    # `ref` is untrusted (it comes from annotations.json). pathlib honours
    # absolute paths and `..`, so a malicious ref could embed an off-folder
    # image into the export. Resolve and require containment (SEC Vuln 2).
    if not isinstance(ref, str) or not ref or Path(ref).is_absolute():
        logger.warning("pdd_export: skipping screenshot ref %r for step %s",
                       ref, step.get("step_id", "?"))
        return
    full = (folder / ref).resolve()
    base = folder.resolve()
    if base != full and base not in full.parents:
        logger.warning("pdd_export: skipping out-of-folder screenshot ref %s for step %s",
                       ref, step.get("step_id", "?"))
        return
    if full.exists() and Inches is not None:
        try:
            doc.add_picture(str(full), width=Inches(4.5))
        except (FileNotFoundError, OSError, ValueError) as exc:
            logger.warning("pdd_export: skipping screenshot %s for step %s: %s",
                           ref, step.get("step_id", "?"), exc)


# ---- 4.6 Input data -----------------------------------------------------------

def _write_input_data(doc, s):
    """The distinct fields entered across the process, each with its step:
    the pattern run's first, then what only the other runs entered."""
    doc.add_heading("4.6 Input data", level=2)
    if not s.have_events:
        _note(doc, "The recorded field entries were not available to this export.")
        return
    first = s.run_steps(s.pattern_index) if s.pattern_index is not None else []
    in_first = {id(st) for st in first}
    ordered = first + [st for st in s.steps if id(st) not in in_first]
    rows, seen = [], set()
    for step in ordered:
        for field, value in s.fields_of(step):
            key = (field, _align_key(step))
            if key not in seen:
                seen.add(key)
                rows.append((field, _step_name(step), value))
    if not rows:
        doc.add_paragraph("No field entries were recorded in the steps of this process.")
        return
    _table(doc, ("Field", "Step", "Example value"), rows)


# ---- 5. Automation assessment ------------------------------------------------

def _write_automation(doc, s, model):
    """5.3 lists the repeated step sequences (ADR-0016 segment grain) that
    section 1 does not already describe (DA gap 2), each with measured counts
    and times only."""
    doc.add_heading("5. Automation assessment", level=1)
    doc.add_heading("5.1 In scope", level=2)
    _placeholder(doc, "which steps or sequences of steps are in scope for automation")
    doc.add_heading("5.2 Out of scope", level=2)
    _placeholder(doc, "which steps are explicitly out of scope, and why")

    doc.add_heading("5.3 Automation candidates", level=2)
    doc.add_paragraph(
        "A candidate is a whole sequence of steps: an unbroken stretch of work "
        "in one application within one run, repeated in the recording. A "
        "single click or keystroke is not a meaningful unit to automate on its "
        "own; a sequence of steps is the smallest stretch an automated "
        "solution can take over end to end.")
    if "automation_candidates" in s.failed:
        # C12: a failed check is not "this recording lacks the repetition".
        _note(doc, f"The automation-candidate check {_COULD_NOT_RUN}.")
        return
    cands = sorted((c for c in s.analysis.get("automation_candidates") or []
                    if isinstance(c, dict) and c.get("data_sufficiency") == "multi_instance"),
                   key=lambda c: -(c.get("total_elapsed_ms") or 0))
    if not cands:
        doc.add_paragraph("No sequence of steps was repeated in this recording, "
                          "so no candidate was identified from it.")
        return
    in_findings = {f.get("segment_signature"): i
                   for i, f in enumerate(model.get("findings") or [], start=1)
                   if f.get("segment_signature")}
    covered = [in_findings[c.get("segment_signature")] for c in cands
               if c.get("segment_signature") in in_findings]
    rest = [c for c in cands if c.get("segment_signature") not in in_findings]
    if covered:
        doc.add_paragraph(
            f"Section 1 already describes {_plural(len(covered), 'candidate')} "
            f"(finding{'s' if len(covered) != 1 else ''} {_joined(sorted(covered))}); "
            f"{'it is' if len(covered) == 1 else 'they are'} not repeated here.")
    if rest:
        rows = []
        for c in rest:
            labels = [str(x) for x in c.get("step_labels") or [] if str(x).strip()]
            seq = " → ".join(labels[:5]) + (f" → … (+{len(labels) - 5} more)"
                                            if len(labels) > 5 else "")
            rows.append((seq or "(unnamed steps)",
                         display_name(c.get("app"), s.app_names) or "Not recorded",
                         c.get("instance_count") or 0,
                         _fmt_ms(c.get("total_elapsed_ms")),
                         _fmt_ms(c.get("mean_elapsed_ms"))))
        _table(doc, ("Step sequence", "Application", "Times run", "Total time",
                     "Average per run"), rows)
        _note(doc, "Each repetition is timed from its first to its last "
                   "recorded action; the sequences are ordered by total time.")


def _write_tobe_map(doc, tobe_map_image):
    """Embed an analyst-authored To-Be map when one was selected for the PDD
    (ADR-0019), captioned so it is never mistaken for observed evidence. The
    section is omitted entirely when no To-Be map is selected."""
    if not (tobe_map_image and Path(tobe_map_image).exists() and Inches is not None):
        return
    doc.add_heading("5.4 Proposed to-be process", level=2)
    try:
        doc.add_picture(str(tobe_map_image), width=Inches(6.0))
    except (FileNotFoundError, OSError, ValueError) as exc:
        logger.warning("pdd_export: could not embed to-be map %s: %s",
                       tobe_map_image, exc)
        return
    _note(doc, "Analyst-authored proposed future-state process: drawn by hand, "
               "NOT mined from the recorded events.")


# ---- 6. Exceptions and variations ---------------------------------------------

def _write_exceptions(doc, s):
    doc.add_heading("6. Exceptions and variations", level=1)
    _write_run_differences(doc, s)
    doc.add_heading("6.2 Business rules and exceptions", level=2)
    for label, key, placeholder in (
            ("Business rules", "business_rules",
             "the business rules the process follows"),
            ("Exceptions", "exceptions",
             "the business exceptions and how each one is handled")):
        doc.add_paragraph().add_run(label).bold = True
        _field_or_placeholder(doc, s.field(key), placeholder)
    _write_rework(doc, s)
    doc.add_heading("6.4 Application errors", level=2)
    _placeholder(doc, "system or application errors that can interrupt the "
                      "process, and the recovery steps for each")


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
    same rule as viewer/run-differences.js collapseToReference."""
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
            out.append({"name": best[1].get("name"), "draft_keys": list(best[0])})
            i += best_len
        else:
            out.append(run_steps[i])
            i += 1
    return out


def _differences(pattern_steps, run_steps) -> list[str]:
    """One line per difference of a run from the pattern run: steps it
    skipped, extra steps, and steps done in a different order. Steps are
    matched by their align key, after the run's stretches that spell a
    merged pattern step are folded (_collapse_merged); a step repeated
    within a run counts once here (section 6.3 lists repeats). The viewer's
    differences review (viewer/run-differences.js) mirrors this; both are
    pinned by shared/run-differences-golden.json."""
    units = _collapse_merged(pattern_steps, run_steps)
    pat, run = _first_occurrences(pattern_steps), _first_occurrences(units)
    pat_keys, run_keys = [k for k, _s, _i in pat], [k for k, _s, _i in run]
    in_order = _common_order(pat_keys, run_keys)
    out = []
    for key, step, i in run:
        where = (f"after {_step_name(units[i - 1])}" if i
                 else "at the start of the run")
        if key not in pat_keys:
            out.append(f"Extra step: {_step_name(step)} ({where}).")
        elif key not in in_order:
            out.append(f"Different order: {_step_name(step)} (in this run {where}).")
    for key, step, i in pat:
        if key not in run_keys:
            out.append(f"Skipped: {_step_name(step)} (step {i + 1} of the pattern run).")
    return out


def _write_run_differences(doc, s):
    """6.1: every other run aligned to the pattern run (DA gap 4: only the
    differences that occurred, no single-occurrence variant table)."""
    doc.add_heading("6.1 Differences between runs", level=2)
    if not s.runs:
        doc.add_paragraph("Runs were not marked in this recording, so there are "
                          "no runs to compare.")
        return
    if s.pattern_index is None:
        doc.add_paragraph("None of the recorded runs has steps, so the runs "
                          "cannot be compared.")
        return
    others = [i for i in range(len(s.runs)) if i != s.pattern_index]
    if not others:
        doc.add_paragraph("Only one run was recorded, so there is no other run "
                          "to compare with the pattern run.")
        return
    doc.add_paragraph(
        f"Each other run is compared with the pattern run "
        f"({s.run_label(s.pattern_index)}), step by step. Only the differences "
        "that occurred are listed; a step done more than once within a run is "
        "listed under 6.3.")
    pattern = s.run_steps(s.pattern_index)
    same = []
    for i in others:
        diffs = _differences(pattern, s.run_steps(i))
        if not diffs:
            same.append(s.run_label(i))
            continue
        doc.add_paragraph().add_run(s.run_label(i)).bold = True
        for line in diffs:
            doc.add_paragraph(line, style="List Bullet")
    if same:
        doc.add_paragraph(f"No differences from the pattern run: {_joined(same)}.")


def _write_rework(doc, s):
    """6.3: steps done more than once within one run (measured from the
    recorded steps of every run, the pattern run included)."""
    doc.add_heading("6.3 Rework", level=2)
    if not s.runs:
        doc.add_paragraph("Runs were not marked in this recording, so repeated "
                          "work within a run cannot be identified.")
        return
    lines = []
    for i in range(len(s.runs)):
        steps = s.run_steps(i)
        counts = Counter(_align_key(st) for st in steps)
        repeated = [f"{_step_name(st)} ({counts[key]} times)"
                    for key, st, _i in _first_occurrences(steps) if counts[key] > 1]
        if repeated:
            lines.append(f"{s.run_label(i)}: {'; '.join(repeated)}.")
    if not lines:
        doc.add_paragraph("No step was done more than once within a run.")
        return
    doc.add_paragraph("Steps done more than once within one run:")
    for line in lines:
        doc.add_paragraph(line, style="List Bullet")


# ---- 7. Notes -----------------------------------------------------------------

def _write_notes(doc, s):
    """7: the analyst's notes (C6 `document.notes`) as the last section. An
    empty field adds nothing, no heading and no placeholder: notes are
    optional, so their absence is not a gap in the document."""
    notes = s.field("notes")
    if not notes:
        return
    doc.add_heading("7. Notes", level=1)
    _text(doc, notes)


# ---- footer & formatting ------------------------------------------------------

def _write_footer(doc):
    _note(doc, "Generated by the Process Discovery Viewer on "
               + datetime.now(timezone.utc).strftime("%Y-%m-%d") + ".")


def _fmt_ms(ms):
    """A duration in the findings' format ("46s", "1m 07s"), so section 1 and
    the timings table print the same number the same way (DA gap 7). A
    non-numeric value (hand-edited annotations, odd analysis) is "-"."""
    if not _num(ms):
        return "-"
    return _fmt_duration(ms)
