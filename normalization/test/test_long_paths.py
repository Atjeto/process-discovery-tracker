"""The pipeline in a project folder with a long path (lane LP, the owner's
report of 2026-11-23).

A project made beside a Teams recording deep in OneDrive has a path past 260
characters. Electron reads and writes it; the bundled Python does not unless
Windows has LongPathsEnabled, which a locked-down laptop never has: the
first staged output (`<name>.pdt-staged`, the longest names the pipeline
writes) failed with FileNotFoundError [Errno 2]. normalize.py and
transcript_import.py now turn every path of their command line into an
extended-length path once (session_io.long_path), and nothing they show or
write carries the prefix (session_io.plain_path).

The end to end tests run the real scripts in a subprocess, as the viewer
does, on a copy of the committed demo; they run on Windows only and need
pandas, pm4py and python-docx (the full-deps gate).
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

HERE = Path(__file__).resolve().parent
NORMALIZATION = HERE.parent
sys.path.insert(0, str(NORMALIZATION))

import session_io  # noqa: E402
from session_io import long_path, plain_path  # noqa: E402

DEMO = NORMALIZATION.parent / "sessions" / "example-aggregate" / "sess-2026-0514-0900"
TAXONOMY = NORMALIZATION / "taxonomy.yaml"
PREFIX = "\\\\?\\"

_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py", "docx"))
_windows_only = pytest.mark.skipif(sys.platform != "win32", reason="extended-length paths are Windows'")
_needs_deps = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps (pandas/pm4py/python-docx) not installed")


# ---- long_path and plain_path -------------------------------------------------

@_windows_only
def test_long_path_prefixes_a_plain_drive_path():
    assert str(long_path(r"C:\Users\pm\Projects\Order to cash")) == PREFIX + r"C:\Users\pm\Projects\Order to cash"


@_windows_only
def test_long_path_makes_a_relative_path_absolute_first(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert str(long_path(r"sub\..\project")) == PREFIX + str(tmp_path / "project")


@_windows_only
def test_long_path_leaves_a_prefixed_path_as_it_is():
    already = PREFIX + r"C:\a\b"
    assert str(long_path(already)) == already
    assert str(long_path(long_path(r"C:\a\b"))) == already


@_windows_only
def test_long_path_turns_a_unc_path_into_the_unc_form():
    assert str(long_path(r"\\server\share\Projects\x")) == PREFIX + r"UNC\server\share\Projects\x"
    assert plain_path(long_path(r"\\server\share\Projects\x")) == r"\\server\share\Projects\x"


def test_long_path_is_a_no_op_off_windows(monkeypatch):
    # session_io's own os reads "posix"; pytest's stays as it is.
    monkeypatch.setattr(session_io, "os", SimpleNamespace(name="posix", path=os.path))
    assert str(long_path("relative/project")) == str(Path("relative/project"))
    assert long_path(None) is None


def test_plain_path_strips_the_prefix_from_a_path_and_from_a_message():
    assert plain_path(PREFIX + r"C:\a\b") == r"C:\a\b"
    assert plain_path(PREFIX + r"UNC\server\share\x") == r"\\server\share\x"
    assert plain_path(r"C:\a\b") == r"C:\a\b"
    message = f"[Errno 2] No such file or directory: '{PREFIX}C:\\a\\annotations.json'"
    assert plain_path(message) == "[Errno 2] No such file or directory: 'C:\\a\\annotations.json'"
    # str(OSError) shows the filename as a repr, every backslash doubled.
    err = FileNotFoundError(2, "No such file or directory", PREFIX + r"C:\a\annotations.json")
    assert plain_path(str(err)) == "[Errno 2] No such file or directory: 'C:\\\\a\\\\annotations.json'"
    unc = FileNotFoundError(2, "No such file or directory", PREFIX + r"UNC\srv\share\x")
    assert plain_path(str(unc)) == "[Errno 2] No such file or directory: '\\\\\\\\srv\\\\share\\\\x'"


# ---- the pipeline in a long folder ----------------------------------------------

def _run_cli(*args):
    return subprocess.run(
        [sys.executable, str(NORMALIZATION / "normalize.py"), *map(str, args)],
        capture_output=True, text=True, cwd=str(NORMALIZATION.parent))


def _long_folder(base: Path, length: int) -> str:
    """A folder under `base` whose plain path is `length` characters, made
    through the prefix (Windows refuses the plain path); returns it plain."""
    plain = str(base)
    current = PREFIX + plain
    while len(plain) < length:
        remaining = length - len(plain)
        n = remaining - 1 if remaining <= 41 else (40 if remaining - 41 >= 2 else 38)
        part = "Radna_povrsina_PROJEKTI_Meeting_Recording"[:n]
        plain = plain + "\\" + part
        current = current + "\\" + part
        os.mkdir(current)
    assert len(plain) == length, len(plain)
    return plain


def _demo(folder_plain: str) -> None:
    long = PREFIX + folder_plain
    for name in ("events.jsonl", "manifest.json", "annotations.json"):
        shutil.copyfile(DEMO / name, os.path.join(long, name))
    for name in ("analysis.json", "stats.json", "process_map_step.bpmn"):
        assert not os.path.exists(os.path.join(long, name))


def _text_files(folder_plain: str) -> dict[str, str]:
    long = Path(PREFIX + folder_plain)
    return {p.name: p.read_text(encoding="utf-8") for p in long.iterdir()
            if p.is_file() and p.suffix in (".json", ".log", ".bpmn")}


# 240: the project folder fits, its outputs' staged names do not (the
# owner's case: annotations.json.pdt-staged is the first path past the
# limit). 290: the folder itself is past it.
@_windows_only
@_needs_deps
@pytest.mark.parametrize("length", [240, 290])
def test_the_pipeline_runs_in_a_folder_with_a_long_path(tmp_path, length):
    folder = _long_folder(tmp_path, length)
    _demo(folder)
    pdd_out = folder + "\\Order to cash PDD.docx"
    tech_out = folder + "\\Order to cash Technical details.xlsx"
    assert len(pdd_out) > 260 and len(tech_out) > 260

    proc = _run_cli(folder, "--taxonomy", TAXONOMY, "--mine",
                    "--pdd-out", pdd_out, "--tech-out", tech_out)

    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    for name in ("analysis.json", "stats.json", "process_map_step.bpmn", "annotations.json"):
        assert os.path.isfile(os.path.join(PREFIX + folder, name)), name
    assert os.path.isfile(PREFIX + pdd_out) and os.path.isfile(PREFIX + tech_out)
    assert not list(Path(PREFIX + folder).glob("*" + session_io.STAGED_SUFFIX))
    written = _text_files(folder)
    assert {"analysis.json", "stats.json", "annotations.json"} <= set(written)
    for name, text in written.items():
        assert PREFIX not in text and PREFIX.replace("\\", "\\\\") not in text, name
    assert PREFIX not in proc.stdout and PREFIX not in proc.stderr
    # The paths it shows and writes are the plain ones the viewer passed.
    stats = json.loads(written["stats.json"])
    assert stats["meta"]["session_folder"] == folder
    assert f"[normalize] wrote PDD: {pdd_out}" in proc.stdout


@_windows_only
def test_a_transcript_is_imported_into_a_folder_with_a_long_path(tmp_path):
    folder = _long_folder(tmp_path, 290)
    long = PREFIX + folder
    with open(os.path.join(long, "events.jsonl"), "w", encoding="utf-8") as f:
        f.write('{"event_id": "e1", "type": "system", "timestamp": "2026-09-23T09:00:00Z", "data": {}}\n')
    source = folder + "\\Meeting Recording transcript.vtt"
    with open(PREFIX + source, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Ana Kovac>Now I look up the customer.</v>\n")

    proc = subprocess.run([sys.executable, str(NORMALIZATION / "transcript_import.py"), folder, source],
                          capture_output=True, timeout=60)

    out, err = proc.stdout.decode("utf-8"), proc.stderr.decode("utf-8")
    assert proc.returncode == 0, out + err
    doc = json.loads(Path(long, "transcript.json").read_text(encoding="utf-8"))
    assert doc["source_file"] == "transcript/Meeting Recording transcript.vtt"
    assert os.path.isfile(os.path.join(long, "transcript", "Meeting Recording transcript.vtt"))
    assert PREFIX not in out and PREFIX not in err
    assert "[transcript] imported Meeting Recording transcript.vtt: 1 segment" in out
