"""Where a step happened and when, in the reader's words.

The PDD and the step-level map describe each step by the system and the
screen it happened in, and place it in the recording ("Run 1 at 0:19", and
the video time when a video is attached). This module derives those from the
step's own recorded interactions, so a step the analyst renamed keeps its
system and screen (the name no longer says them).

System: the business system, named by the one vocabulary of systems
(shared/system-names.json through app_names.system_name, the list the viewer
reads too): "SAP", "Excel", and for a browser window the web system its
title names ("Salesforce"), else the application's readable name. A system
the analyst set on the step (`step.system`, contract C16) wins.

Screen: the step's window title, value-free (the shared screen-label rules,
step_suggest.screen_label), without the title segments that only name the
system ("Excel" in "Excel - Order Tracking.xlsx", "SAP" in "SAP - Create
Sales Order (VA01)"). When an app vocabulary names the step's screen
(its interactions carry the vocabulary's screen_id) and that name contains
the title's screen, the vocabulary's name is used: it keeps what the
value rules strip ("Create Sales Order (VA01)", not "Create Sales Order").

Pure apart from reading the app vocabularies (app_vocab); no python-docx.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from _dt import parse_ts_or_none as _parse_ts
from app_names import app_key, display_name, system_name
from step_suggest import VALUE_MARK, screen_label

# The separators between a window title's segments: a spaced hyphen, pipe,
# en dash or em dash (built with chr() so this source holds no dash
# characters), or "::". The same split app_names uses.
_TITLE_SPLIT = re.compile(r"\s+(?:[-|" + chr(0x2013) + chr(0x2014) + r"]|::)\s+")
_EMPTY_BRACKETS = re.compile(r"\s*(?:\(\s*\)|\[\s*\])")
_MIN_SEGMENT = 3


def load_vocabs() -> list[dict]:
    """The loaded app vocabularies ([] when none can be read: the screens
    then come from the window titles alone)."""
    try:
        import app_vocab
        return app_vocab.load_vocabularies()
    except Exception:  # noqa: BLE001 (no vocabularies is a normal state)
        return []


def _most_common(values) -> str:
    counts = Counter(v.strip() for v in values if isinstance(v, str) and v.strip())
    if not counts:
        return ""
    best = max(counts.values())
    return next(v.strip() for v in values
                if isinstance(v, str) and v.strip() and counts[v.strip()] == best)


def _names(segment: str, name: str) -> bool:
    """True when a title segment is (part of) a system name: it appears in
    the name as whole words, case-insensitively ("SAP" in "SAP GUI",
    "Excel" in "Microsoft Excel"). Segments shorter than 3 characters never
    count."""
    seg, nm = segment.strip().lower(), name.strip().lower()
    if len(seg) < _MIN_SEGMENT or not nm:
        return False
    return re.search(r"(?<!\w)" + re.escape(seg) + r"(?!\w)", nm) is not None


def screen_names(vocabs: list[dict] | None) -> dict[tuple[str, str], str]:
    """{(vocabulary id, screen id): screen name} of the vocabularies' named
    screens."""
    out: dict[tuple[str, str], str] = {}
    for v in vocabs or []:
        vid = v.get("id") if isinstance(v, dict) else None
        for sc in (v.get("screens") or []) if isinstance(v, dict) else []:
            if (isinstance(sc, dict) and isinstance(vid, str) and isinstance(sc.get("id"), str)
                    and isinstance(sc.get("name"), str) and sc["name"].strip()):
                out[(vid, sc["id"])] = sc["name"].strip()
    return out


def screen_of(title: str, system_names: list[str]) -> str:
    """The value-free screen of a window title: the title's segments that do
    not name the system, joined by ", " ("" when every segment names it)."""
    label = screen_label(title or "")
    if not label or label == "(screen)":
        return ""
    label = " ".join(_EMPTY_BRACKETS.sub("", label).split())
    segs = [s.strip() for s in _TITLE_SPLIT.split(label) if s.strip()]
    names = [n for n in system_names if n]
    kept = [s for s in segs if not any(_names(s, n) for n in names)]
    return ", ".join(kept)


class StepContext:
    """System and screen of steps, from the session's interactions (event_id
    -> interaction data), the readable application names (stats.json
    meta.app_names) and the app vocabularies' screen names."""

    def __init__(self, interactions: dict[str, dict] | None,
                 app_names: dict[str, str] | None,
                 vocabs: list[dict] | None = None, *, role: str = ""):
        self.interactions = interactions if isinstance(interactions, dict) else {}
        self.app_names = app_names if isinstance(app_names, dict) else {}
        vocabs = load_vocabs() if vocabs is None else vocabs
        self.screens = screen_names(vocabs)
        # Contract C25: who does a step without a Done by of its own, the
        # role the recording was made under (recording_role).
        self.role = role if isinstance(role, str) else ""

    def done_by(self, step: dict) -> str:
        """Who does the step (contract C25, step_done_by): its own Done by,
        else the recording's role, else ""."""
        return step_done_by(step, self.role)

    def _datas(self, step: dict) -> list[dict]:
        ids = ((step or {}).get("evidence") or {}).get("interaction_event_ids") or []
        return [d for d in (self.interactions.get(eid) for eid in ids if isinstance(eid, str))
                if isinstance(d, dict)]

    def where_data(self, process_name: Any, window_title: Any) -> tuple[str, str]:
        """(system, screen) for one application and window title."""
        app = process_name.strip() if isinstance(process_name, str) else ""
        title = window_title.strip() if isinstance(window_title, str) else ""
        if not app:
            return "", screen_of(title, [])
        system = system_name(app, title, self.app_names)
        # The title segments that only name the system or the application
        # (the browser a web system ran in) are not the screen.
        names = [system, display_name(app, self.app_names), app_key(app)]
        return system, screen_of(title, names)

    def _vocab_screen(self, datas: list[dict]) -> str:
        """The vocabulary's name for the screen most of these interactions
        were tagged with, or ""."""
        pairs = []
        for d in datas:
            src = d.get("vocab_source")
            vid = src.get("vocab_id") if isinstance(src, dict) else None
            sid = d.get("screen_id")
            if isinstance(sid, str) and sid:
                pairs.append((vid, sid))
        for (vid, sid), _count in Counter(pairs).most_common():
            if isinstance(vid, str) and (vid, sid) in self.screens:
                return self.screens[(vid, sid)]
            named = {n for (v, s), n in self.screens.items() if s == sid}
            if len(named) == 1:
                return named.pop()
        return ""

    def where_datas(self, datas: list[dict]) -> tuple[str, str]:
        """(system, screen) of some interactions (their data dicts): their
        most common application and window title, the screen named by a
        vocabulary when one tagged it. ("", "") when they carry neither."""
        datas = [d for d in datas or [] if isinstance(d, dict)]
        app = _most_common([d.get("process_name") for d in datas])
        title = _most_common([d.get("window_title") for d in datas])
        if not app and not title:
            return "", ""
        system, screen = self.where_data(app, title)
        named = self._vocab_screen(datas)
        if named and (not screen or screen.lower() in named.lower()):
            screen = named
        return system, screen

    def where(self, step: dict) -> tuple[str, str]:
        """(system, screen) of a step: its interactions' (where_datas);
        without interactions, the step's grain_keys (app, screen) or its
        draft_key. ("", "") when unknown. The system the analyst set on the
        step (C16) wins over the derived one; the screen stays derived. A
        draft whose screen the drafting made value-free across the
        transactions (lane LF-PIPE: "New order for ... | Order Desk", a
        customer's name left out) says that screen (value_free_screen)."""
        system, screen = self._where(step)
        system = step_system(step) or system
        return system, self.value_free_screen(step, system) or screen

    def value_free_screen(self, step: dict, system: str = "") -> str:
        """The screen of a draft whose window titles carried a value the
        drafting left out (step_suggest.value_free_screens: its draft_key's
        screen holds the ellipsis), without the segments that name
        `system`; "" for any other step."""
        dk = step.get("draft_key") if isinstance(step, dict) else None
        if not isinstance(dk, str) or dk.count("|") < 2:
            return ""
        screen = dk.split("|", 1)[1].rsplit("|", 1)[0]
        return screen_of(screen, [system]) if VALUE_MARK in screen else ""

    def _where(self, step: dict) -> tuple[str, str]:
        found = self.where_datas(self._datas(step))
        if found != ("", ""):
            return found
        app = title = ""
        gk = (step or {}).get("grain_keys")
        if isinstance(gk, dict):
            a, sc = gk.get("app"), gk.get("screen")
            app = a if isinstance(a, str) and a not in ("", "(app)") else ""
            title = sc if isinstance(sc, str) and sc not in ("", "(screen)") else ""
        if not app and not title:
            dk = (step or {}).get("draft_key")
            if isinstance(dk, str) and dk.count("|") >= 2:
                a, rest = dk.split("|", 1)
                sc = rest.rsplit("|", 1)[0]
                app = a if a not in ("", "(app)") else ""
                title = sc if sc not in ("", "(screen)") else ""
        if not app and not title:
            return "", ""
        system, screen = self.where_data(app, title)
        # A grain or draft screen can be a vocabulary's screen id ("va01").
        named = {n for (_v, sid), n in self.screens.items() if sid == title}
        return system, (named.pop() if len(named) == 1 else screen)


def step_system(step: dict | None) -> str:
    """The system the analyst set on the step (`step.system`, contract C16),
    or "" when none is set. It wins over the system derived from the
    step's recorded interactions."""
    value = step.get("system") if isinstance(step, dict) else None
    return value.strip() if isinstance(value, str) else ""


def step_start(step: dict):
    """The step's start time (datetime), or None."""
    tr = step.get("time_range") if isinstance(step, dict) else None
    return _parse_ts(tr.get("start")) if isinstance(tr, dict) else None


def step_ms(step: dict) -> float:
    """A step's duration in ms: its time_range, from its first to its last
    recorded action (0 when the range is missing or inverted)."""
    return step_duration_ms(step) or 0.0


def step_duration_ms(step: dict) -> float | None:
    """A step's measured duration in ms, or None when the step has no time
    range (contract C16: a step added by hand may have `time_range: null`,
    and timed statistics leave such steps out). An inverted range measures
    0, as step_ms."""
    tr = step.get("time_range") if isinstance(step, dict) else None
    if not isinstance(tr, dict):
        return None
    a, b = _parse_ts(tr.get("start")), _parse_ts(tr.get("end"))
    if a is None or b is None:
        return None
    return max(0.0, (b - a).total_seconds() * 1000.0)


def untimed_key(step: dict) -> tuple[int, float]:
    """Where a step without a start time sorts among its run's steps
    (contract C16): after every step with a time, by its `order` (a number
    the viewer sets, unique within the run); a step with neither comes
    last. Compare it only with other untimed_key values; step_sort_key
    puts the timed steps before them."""
    order = step.get("order") if isinstance(step, dict) else None
    if (isinstance(order, (int, float)) and not isinstance(order, bool)
            and math.isfinite(order)):
        return (1, float(order))
    return (2, 0.0)


def step_sort_key(step: dict) -> tuple[int, float]:
    """The base order of a run's steps (contract C16): a step with a start
    time by that time, then the steps without one by their `order`
    (untimed_key). Python's sort is stable, so equal keys keep the list
    order. A step the analyst placed elsewhere in the process (contract
    C22, `placed_after`) is ordered by process_order, which starts from
    this order."""
    start = step_start(step)
    if start is not None:
        try:
            return (0, start.timestamp())
        except (OverflowError, OSError, ValueError):
            pass
    return untimed_key(step)


# Contract C22 (2.0.5, the owner's report: a correction the SME shows late
# in a video belongs early in the process). `placed_after` names the step a
# step comes after in its transaction's process, or PLACED_FIRST; its
# time_range stays where it was shown. The rule is viewer/step-order.js's,
# pinned for both by shared/step-order-golden.json.
PLACED_FIRST = "start"
# The moment a step placed first counts at: before every stretch.
BEFORE_EVERY_STRETCH = datetime.min.replace(tzinfo=timezone.utc)


def _case_of(step: dict):
    cid = step.get("case_id")
    return cid if isinstance(cid, str) and cid else None


def _held_placements(items: list[dict]) -> dict[int, Any]:
    """{id(step): PLACED_FIRST or the step it comes after} for the
    placements that hold: "start", or a step of the same list that is
    visible, of the same transaction and not the step itself, when it does
    not lead back to the step. Any other placement is ignored."""
    by_id: dict[str, dict] = {}
    for s in items:
        sid = s.get("step_id")
        if isinstance(sid, str) and sid and sid not in by_id:
            by_id[sid] = s
    named: dict[int, Any] = {}
    for s in items:
        a = s.get("placed_after")
        if a == PLACED_FIRST:
            named[id(s)] = PLACED_FIRST
            continue
        if not isinstance(a, str) or not a:
            continue
        t = by_id.get(a)
        if (t is None or t is s or t.get("state") == "hidden"
                or _case_of(t) != _case_of(s)):
            continue
        named[id(s)] = t
    held: dict[int, Any] = {}
    for s in items:
        if id(s) not in named:
            continue
        seen: set[int] = set()
        x = named[id(s)]
        loops = False
        while True:
            if x is s:
                loops = True
                break
            if x == PLACED_FIRST or id(x) not in named or id(x) in seen:
                break
            seen.add(id(x))
            x = named[id(x)]
        if not loops:
            held[id(s)] = named[id(s)]
    return held


def _order_plan(steps: Any) -> tuple[list[dict], dict[int, Any]]:
    """The process order of one list of steps and, per step, the step its
    place hangs from (itself when its time places it, PLACED_FIRST for the
    steps placed first)."""
    items = [s for s in (steps or []) if isinstance(s, dict)]
    base = sorted(items, key=step_sort_key)
    held = _held_placements(items)
    kids: dict[Any, list[dict]] = {}
    for s in base:
        if id(s) in held:
            a = held[id(s)]
            kids.setdefault(PLACED_FIRST if a == PLACED_FIRST else id(a), []).append(s)
    order: list[dict] = []
    root: dict[int, Any] = {}

    def emit(key, r):
        for c in kids.get(key, []):
            order.append(c)
            root[id(c)] = r
            emit(id(c), r)

    emit(PLACED_FIRST, PLACED_FIRST)
    for s in base:
        if id(s) in held:
            continue
        order.append(s)
        root[id(s)] = s
        emit(id(s), s)
    return order, root


def process_order(steps: Any) -> list[dict]:
    """The process order of one list of steps, a transaction's or a
    sub-process's (contract C22): the base order (step_sort_key), the steps
    placed first first, and every step followed by the steps placed after
    it, in the base order, each followed by its own. A hidden step is never
    a step another comes after, so a list with or without its hidden steps
    reads the same order. A new list."""
    return _order_plan(steps)[0]


def place_starts(steps: Any) -> dict[int, Any]:
    """{id(step): the moment it counts at} among a transaction's stretches
    left out of the analysis (lane FX1's cuts and the differences): its own
    start, or for a placed step the start of the step its place hangs from;
    BEFORE_EVERY_STRETCH for the steps placed first, None when that step has
    no time (after every stretch). viewer/step-order.js placeMoments."""
    _order, root = _order_plan(steps)
    return {k: (BEFORE_EVERY_STRETCH if r == PLACED_FIRST else step_start(r))
            for k, r in root.items()}


def declares_place(step: Any) -> bool:
    """True when the analyst placed the step in the process (C22): it
    carries a placed_after."""
    a = step.get("placed_after") if isinstance(step, dict) else None
    return isinstance(a, str) and bool(a.strip())


# ---- contract C25: what the automation does with a step, and who does it ----------

# The choices of `step.automation`, in the step editor's order, with the
# words the viewer and the PDD read them as (viewer/step-scope.js CHOICES).
AUTOMATION_WORDS = {
    "undecided": "Not decided yet",
    "automated": "The automation does it",
    "person": "Stays with a person",
    "not_needed": "No longer needed",
}
DONE_BY_MAX = 80


def step_automation(step: Any) -> str:
    """What the automation does with a step (contract C25): its
    `automation` when it is one of AUTOMATION_WORDS; "not_needed" for a step
    flagged as waste (`flags.waste: true`) that carries none (an older
    project, a vocabulary's default); else "undecided" (an unknown value
    too)."""
    if not isinstance(step, dict):
        return "undecided"
    value = step.get("automation")
    if value is None:
        flags = step.get("flags")
        return "not_needed" if isinstance(flags, dict) and flags.get("waste") is True else "undecided"
    return value if isinstance(value, str) and value in AUTOMATION_WORDS else "undecided"


def _one_line(value: Any) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def recording_role(manifest: Any) -> str:
    """The role the recording was made under (contract C25): the capture
    profile's `manifest.config.worker.role`, its first letter a capital
    ("Sales assistant"), or "" when none is set."""
    config = manifest.get("config") if isinstance(manifest, dict) else None
    worker = config.get("worker") if isinstance(config, dict) else None
    role = _one_line(worker.get("role")) if isinstance(worker, dict) else ""
    return role[:1].upper() + role[1:]


def step_done_by(step: Any, role: str = "") -> str:
    """Who does a step (contract C25): its own `done_by` (one line, at most
    DONE_BY_MAX characters), else `role` (recording_role), else ""."""
    own = _one_line(step.get("done_by")) if isinstance(step, dict) else ""
    return own[:DONE_BY_MAX] or (role or "")


def declares_scope(step: Any) -> bool:
    """True when the analyst chose what the automation does with the step or
    who does it (contract C25): it carries an `automation`, or a `done_by`
    that is not empty. A draft that does is the analyst's (kept `edited`)."""
    if not isinstance(step, dict):
        return False
    return isinstance(step.get("automation"), str) or bool(_one_line(step.get("done_by")))


# ---- contract C26: the information a step uses or enters -------------------------

INFO_NAME_MAX = 80
INFO_TEXT_MAX = 120


def _info_line(value: Any, limit: int) -> str:
    return _one_line(value)[:limit].strip()


def step_information(step: Any) -> list[dict]:
    """The lines of information the analyst typed on a step (contract C26,
    `step.information`, viewer/step-information.js), cleaned as the viewer
    keeps them: [{"name", "example", "goes_to"}] in the analyst's order, a
    name at most INFO_NAME_MAX characters, an example and where it goes at
    most INFO_TEXT_MAX each ("" when not given); a line without a name, or
    anything but a mapping, is left out. The pipeline never writes the key."""
    items = step.get("information") if isinstance(step, dict) else None
    out: list[dict] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        name = _info_line(item.get("name"), INFO_NAME_MAX)
        if name:
            out.append({"name": name, "example": _info_line(item.get("example"), INFO_TEXT_MAX),
                        "goes_to": _info_line(item.get("goes_to"), INFO_TEXT_MAX)})
    return out


def declares_information(step: Any) -> bool:
    """True when the analyst typed a line of information on the step
    (contract C26). A draft that did is the analyst's (kept `edited`)."""
    return bool(step_information(step))


def fmt_ms(ms: Any) -> str:
    """A duration in the reader's words, the one rule the viewer's dom.js
    formatDuration shares (2.0.1): "under 1s", "42s", "2m 07s", "3m",
    "1h 04m"; never "0s", and "" for a missing or negative value. The step
    map's documentation ("12s on average")."""
    if (isinstance(ms, bool) or not isinstance(ms, (int, float))
            or not math.isfinite(ms) or ms < 0):
        return ""
    if ms < 1000:
        return "under 1s"
    s = int(math.floor(ms / 1000.0 + 0.5))   # half up, as Math.round
    if s < 60:
        return f"{s}s"
    m, s = divmod(s, 60)
    if m < 60:
        return f"{m}m {s:02d}s" if s else f"{m}m"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m"


def clock(ms: Any) -> str:
    """A position in a recording or a video: "0:19", "12:05", "1:02:03"."""
    if (isinstance(ms, bool) or not isinstance(ms, (int, float))
            or not math.isfinite(ms) or ms < 0):
        return ""
    s = int(ms // 1000)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _finite_ms(v) -> bool:
    return (isinstance(v, (int, float)) and not isinstance(v, bool)
            and math.isfinite(v) and abs(v) < 8.64e10)


def video_clips(annotations: dict | None) -> list[dict]:
    """The project's videos (contract C23, 2.0.6): annotations.external_videos,
    each with a path, in the order they start on the clock (offset_ms plus
    in_ms); a project of 2.0.5 or older has one, external_video. The
    viewer's video-chain.js clipsOf, the same rule."""
    ann = annotations if isinstance(annotations, dict) else {}
    raw = ann.get("external_videos")
    if not isinstance(raw, list):
        raw = [ann.get("external_video")]
    out = []
    for c in raw:
        if not isinstance(c, dict) or not isinstance(c.get("path"), str) or not c["path"].strip():
            continue
        off = c.get("offset_ms") if _finite_ms(c.get("offset_ms")) else 0
        inn = c.get("in_ms") if _finite_ms(c.get("in_ms")) and c.get("in_ms") > 0 else 0
        out.append(dict(c, offset_ms=off, in_ms=inn))
    return sorted(out, key=lambda c: c["offset_ms"] + c["in_ms"])


def video_start(manifest: dict | None, annotations: dict | None):
    """When the session's first video's file starts (datetime), or None: an
    attached video placed on the session's clock (offset_ms, relative to
    manifest.started_at; C23: the first of the chain), else the OBS
    recording's start."""
    man = manifest if isinstance(manifest, dict) else {}
    clips = video_clips(annotations)
    started = _parse_ts(man.get("started_at"))
    if started is not None and clips:
        from datetime import timedelta
        return started + timedelta(milliseconds=clips[0]["offset_ms"])
    obs = man.get("obs")
    return _parse_ts(obs.get("recording_start_ts")) if isinstance(obs, dict) else None


def video_count(manifest: dict | None, annotations: dict | None) -> int:
    """How many videos the session has: the ones attached in the viewer (C23:
    the chain), else 1 for the OBS recording, else 0."""
    clips = video_clips(annotations)
    if clips:
        return len(clips)
    obs = (manifest or {}).get("obs") if isinstance(manifest, dict) else None
    path = obs.get("recording_path") if isinstance(obs, dict) else None
    return 1 if isinstance(path, str) and path.strip() else 0


def has_video(manifest: dict | None, annotations: dict | None) -> bool:
    """True when the session has a video: one attached in the viewer
    (annotations.external_videos, or external_video, with a path) or the
    OBS recording."""
    return video_count(manifest, annotations) > 0
