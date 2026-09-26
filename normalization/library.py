"""The activity library (contract C21): the named activities of each
application, the names a run of drafted screens takes.

The app's library is one file, library/activities.json at the repository
root (resources/library/activities.json in the packaged viewer); swapping the
library means replacing that file. A project keeps the library it started
with: its first analysis copies the app's library into the project folder as
library.json (project_library), and from then on the project's copy is the
one used, so a newer app library never changes an existing project.

    {"format": 1, "version": "<text>",
     "applications": [
       {"name": "<a system name, as shared/system-names.json gives it>",
        "activities": [
          {"id": "...", "name": "...", "code": "...", "description": "...",
           "screens": [["<draft_key>", ...], ...]}]}]}

`code`, `description` and `screens` are optional (the application order
was the step map's colour order until 2.0.1). An activity's `screens` lists one or more runs
of screens, one draft_key each, in order; a screen repeated back to back
counts once (collapse), so a run is compared with its repeats taken out. An
activity without screens has a name only (for the steps added by hand).

load_library checks the format number, that every activity id is unique,
that the names are unique within an application and that no run of screens
belongs to two activities. A file that is missing or fails a check is an
empty library, never a part of one, and its `problem` says why. Standard
library only.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

FORMAT = 1
# The project's copy of the library, in the project folder.
PROJECT_FILE = "library.json"


@dataclass(frozen=True)
class Activity:
    """One activity: its id, its name, its code and description ("" when it
    has none) and the application it belongs to."""
    id: str
    name: str
    code: str
    description: str
    application: str


@dataclass(frozen=True)
class Library:
    """A library as the pipeline reads it: `version` the file's version text,
    `applications` the application names in the file's order, `activities`
    the activities by id, `runs` the id of the activity each run of screens
    (a tuple, its repeats taken out) belongs to. An empty library carries
    `problem`, why there is none, when a file was asked for; `raw` is the
    file as read, for the project's copy."""
    version: str | None = None
    applications: tuple[str, ...] = ()
    activities: dict = field(default_factory=dict)
    runs: dict = field(default_factory=dict)
    problem: str | None = None
    raw: bytes | None = field(default=None, repr=False)


def collapse(keys) -> tuple[str, ...]:
    """A run of screens with its repeats taken out: a key equal to the one
    before it counts once."""
    out: list[str] = []
    for key in keys:
        if not out or out[-1] != key:
            out.append(key)
    return tuple(out)


def _is_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _optional_text(activity: dict, key: str, aid: str) -> str:
    value = activity.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"the {key} of the activity {aid!r} is not a text")
    return value.strip()


def _is_run(value: Any) -> bool:
    return (isinstance(value, list) and bool(value)
            and all(isinstance(k, str) and k for k in value))


def parse_library(doc: Any, raw: bytes | None = None) -> Library:
    """The library a parsed file holds. Raises ValueError naming the first
    check the file fails: the format number, an application without a name,
    an activity without an id or a name, an id used twice, a name used twice
    in one application, screens that are not runs of draft keys, a run of
    screens (its repeats taken out) that belongs to two activities."""
    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        raise ValueError(f"it is not a format {FORMAT} activity library")
    apps = doc.get("applications")
    if not isinstance(apps, list):
        raise ValueError("its applications are not a list")
    names: list[str] = []
    activities: dict[str, Activity] = {}
    runs: dict[tuple[str, ...], str] = {}
    for i, app in enumerate(apps, start=1):
        if not isinstance(app, dict) or not _is_text(app.get("name")):
            raise ValueError(f"application {i} has no name")
        app_name = app["name"].strip()
        names.append(app_name)
        acts = app.get("activities") or []
        if not isinstance(acts, list):
            raise ValueError(f"the activities of {app_name} are not a list")
        used: set[str] = set()
        for j, act in enumerate(acts, start=1):
            if not (isinstance(act, dict) and _is_text(act.get("id")) and _is_text(act.get("name"))):
                raise ValueError(f"activity {j} of {app_name} has no id or no name")
            aid, name = act["id"].strip(), act["name"].strip()
            if aid in activities:
                raise ValueError(f"the activity id {aid!r} is used twice")
            if name in used:
                raise ValueError(f"the name {name!r} is used twice in {app_name}")
            used.add(name)
            screens = act.get("screens") or []
            if not (isinstance(screens, list) and all(_is_run(r) for r in screens)):
                raise ValueError(f"the screens of the activity {aid!r} are not runs of draft keys")
            for screen_run in screens:
                run = collapse(screen_run)
                other = runs.setdefault(run, aid)
                if other != aid:
                    raise ValueError(f"one run of screens belongs to the activities {other!r} "
                                     f"and {aid!r}")
            activities[aid] = Activity(aid, name, _optional_text(act, "code", aid),
                                       _optional_text(act, "description", aid), app_name)
    version = doc.get("version")
    text = (str(version).strip()
            if isinstance(version, (str, int)) and not isinstance(version, bool) else "")
    return Library(version=text or None, applications=tuple(names), activities=activities,
                   runs=runs, raw=raw)


def load_library(path: str | Path | None) -> Library:
    """The library in the file at `path`. A file that is missing, cannot be
    read, is not JSON or fails a check (parse_library) gives an empty
    library whose `problem` says why."""
    if not path:
        return Library(problem="no library file was given")
    p = Path(path)
    try:
        raw = p.read_bytes()
    except FileNotFoundError:
        return Library(problem=f"{p} was not found")
    except OSError as exc:
        return Library(problem=f"{p} cannot be read ({type(exc).__name__}: {exc})")
    try:
        doc = json.loads(raw.decode("utf-8-sig"))
    except ValueError as exc:       # bad JSON, and bytes that are not UTF-8
        return Library(problem=f"{p} is not a JSON file ({exc})")
    try:
        return parse_library(doc, raw)
    except ValueError as exc:
        return Library(problem=f"{p}: {exc}")


def project_library(folder: str | Path, app_library: str | Path | None = None,
                    staging: Any = None) -> Library:
    """The library an analysis of the project in `folder` uses (contract
    C21), with one line saying which (none when there is no library at all):

    - the project's own library.json when the folder has one, even one that
      cannot be used (then the library is empty, with a warning): it was
      made once, by the project's first analysis, and is never replaced;
    - else the app's library (`app_library`, normalize.py --library), which
      is copied into the project as library.json: staged with the run's
      other outputs (`staging`, session_io.Staging), so it is in place only
      when the run succeeds; without a staging, written at once. An app
      library that is missing or fails a check is not copied, so the next
      analysis copies the file once it is fixed; this one uses an empty
      library, with a warning;
    - else an empty library.
    """
    own = Path(folder) / PROJECT_FILE
    if own.exists():
        lib = load_library(own)
        if lib.problem:
            _warn(f"the project's library cannot be used: {lib.problem}; "
                  "the analysis uses no library")
        else:
            print(f"[normalize] library: the project's {PROJECT_FILE}, {_described(lib)}")
        return lib
    if not app_library:
        return Library()
    lib = load_library(app_library)
    if lib.problem:
        _warn(f"the app's library cannot be used: {lib.problem}; "
              f"the analysis uses no library and the project gets no {PROJECT_FILE}")
        return lib
    if staging is not None:
        staging.write_bytes(PROJECT_FILE, lib.raw)
    else:
        tmp = own.with_name(own.name + ".tmp")
        tmp.write_bytes(lib.raw)
        os.replace(tmp, own)
    print(f"[normalize] library: copied {app_library} into the project as {PROJECT_FILE}, "
          f"{_described(lib)}")
    return lib


def _described(lib: Library) -> str:
    n = len(lib.activities)
    return (f"version {lib.version or '(none)'}, {n} activit{'y' if n == 1 else 'ies'} in "
            f"{len(lib.applications)} application{'' if len(lib.applications) == 1 else 's'}")


def _warn(msg: str) -> None:
    """One warning line on stderr (the pipeline's convention)."""
    one_line = str(msg).replace("\r", " ").replace("\n", " ")
    print(f"[normalize] WARNING: library: {one_line}", file=sys.stderr)
