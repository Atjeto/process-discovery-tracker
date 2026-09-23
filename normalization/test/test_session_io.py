"""annotations.json durability (RP-04, contract C13 code 2).

load_annotations tells "file absent" (a session nobody annotated yet: {})
from "file present but unreadable" (raise, so normalize stops before the
next write replaces the analyst's work). write_annotations is atomic.

session_io is stdlib-only, so this suite runs under any pytest.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import session_io  # noqa: E402
from session_io import AnnotationsUnreadable, load_annotations, write_annotations  # noqa: E402


def test_an_absent_annotations_file_loads_as_empty(tmp_path):
    assert load_annotations(tmp_path) == {}


@pytest.mark.parametrize("raw", [
    b'{"steps": [{"step_id": "m1", "state": "manu',   # truncated mid-write
    b"",                                               # emptied by a crash
    b'{"name": "\xff\xfe"}',                           # not UTF-8
    b"[]",                                             # JSON, but not an object
])
def test_an_unreadable_annotations_file_raises_and_names_the_backups(tmp_path, raw):
    (tmp_path / "annotations.json").write_bytes(raw)
    with pytest.raises(AnnotationsUnreadable) as info:
        load_annotations(tmp_path)
    message = str(info.value)
    assert "annotations.json" in message
    assert "annotations.json.2" in message and "annotations.json.5" in message
    assert (tmp_path / "annotations.json").read_bytes() == raw


def test_write_annotations_replaces_the_file_atomically(tmp_path, monkeypatch):
    """A write that fails part-way (disk full, a cancelled run) must leave the
    previous annotations.json exactly as it was, and no temp file behind."""
    target = tmp_path / "annotations.json"
    previous = json.dumps({"steps": [{"step_id": "m1"}]}).encode("utf-8")
    target.write_bytes(previous)

    def failing_dump(obj, fp, **kwargs):
        fp.write('{"steps": [')
        raise OSError("disk full")
    monkeypatch.setattr(session_io.json, "dump", failing_dump)

    with pytest.raises(OSError):
        write_annotations(tmp_path, {"steps": []})
    assert target.read_bytes() == previous
    assert sorted(p.name for p in tmp_path.iterdir()) == ["annotations.json"]


def test_write_annotations_round_trips(tmp_path):
    write_annotations(tmp_path, {"steps": [{"step_id": "m1"}]})
    loaded = load_annotations(tmp_path)
    assert loaded["steps"] == [{"step_id": "m1"}]
    assert "last_modified" in loaded
    assert sorted(p.name for p in tmp_path.iterdir()) == ["annotations.json"]
