#!/usr/bin/env python
"""Slim the viewer/python embeddable bundle in-place.

Drops packages we don't need at runtime (visualization stack, install
tooling), test directories of large libs, __pycache__ trees, and type
stub files. Verified end-to-end against the normalize.py --mine
pipeline on the demo sessions: every removal here was tested by
moving the folder aside, running the full pipeline, and confirming
the 5 demo sessions still produced stats.json + dfg.json +
process_map.bpmn.

Typical savings (3.11.9 embeddable + normalization/requirements.txt):
  ~463 MB -> ~280 MB

Re-runnable: each removal step is a no-op if the target is already
gone, so this script is safe to run multiple times or to re-invoke
after a fresh build.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PY_DIR = REPO_ROOT / "viewer" / "python"

# Packages safe to remove entirely. Each was verified by running the
# full normalize pipeline against the demo sessions with the package
# physically moved aside.
REMOVABLE_PACKAGES = [
    # Visualization stack (pm4py imports these for its own viz; we
    # render diagrams in JS, never call pm4py's viz APIs).
    "matplotlib", "matplotlib.libs",
    "PIL", "Pillow.libs",
    "fontTools",
    "contourpy", "cycler", "kiwisolver", "pyparsing",
    "pygments",
    # Convex optimizer used by pm4py's alignment-based conformance
    # checker. We use only inductive miner + DFG, no alignments.
    "cvxopt",
    # Install tooling -- the embeddable doesn't pip-install at
    # runtime; users get rebuilt bundles.
    "pip", "setuptools", "wheel",
    "_distutils_hack", "pkg_resources",
]

# Wildcards for directories to wipe across the tree (recursive).
RECURSIVE_DELETE_DIRS = [
    "__pycache__",
    "tests",  # numpy, scipy, pandas, networkx all ship huge test suites
]

# Wildcards for file extensions to wipe across the tree.
RECURSIVE_DELETE_FILE_GLOBS = [
    "*.pyi",   # type stubs, only useful to type checkers
    "*.pyc.md5",
    "*.dist-info/RECORD",  # install manifest, not needed at runtime
]


def human_mb(b: int) -> str:
    return f"{b / (1024 * 1024):.1f} MB"


def folder_bytes(p: Path) -> int:
    total = 0
    for f in p.rglob("*"):
        try:
            if f.is_file():
                total += f.stat().st_size
        except OSError:
            pass
    return total


def rm_tree(p: Path) -> int:
    """Remove a directory tree, returning bytes freed.

    Falls back to robocopy /MIR from an empty dir on Windows when
    shutil.rmtree trips over MAX_PATH. PM4Py has three __pycache__
    paths deep enough (250+ chars) that the normal delete fails with
    [WinError 3] "The system cannot find the path specified."
    Robocopy uses long-path semantics internally and reliably wins.
    """
    if not p.exists():
        return 0
    size = folder_bytes(p)
    try:
        shutil.rmtree(p)
        return size
    except OSError:
        pass
    # Long-path fallback (Windows only -- robocopy ships in Win10+).
    import os
    import subprocess
    import tempfile
    if os.name != "nt":
        return 0
    empty = Path(tempfile.mkdtemp(prefix="pdt-empty-"))
    try:
        subprocess.run(
            ["robocopy", str(empty), str(p), "/MIR",
             "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP",
             "/R:1", "/W:1"],
            capture_output=True,
        )
        try:
            p.rmdir()
        except OSError:
            pass
        if not p.exists():
            return size
        return 0
    finally:
        try:
            empty.rmdir()
        except OSError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Slim a python embeddable bundle in-place.")
    parser.add_argument(
        "--path", type=Path, default=DEFAULT_PY_DIR,
        help=("Path to the python embeddable folder to slim (the folder "
              "containing python.exe). Defaults to viewer/python."),
    )
    parser.add_argument(
        "--skip-smoke-test", action="store_true",
        help=("Skip the post-slim smoke test. Useful when running against a "
              "packaged dist tree where the python.exe path may have site "
              "module changes that the smoke imports don't tolerate."),
    )
    args = parser.parse_args(argv)
    py_dir = args.path.resolve()
    site = py_dir / "Lib" / "site-packages"

    if not site.exists():
        print(f"ERROR: site-packages not found at {site}")
        print("Build the embeddable first via scripts/build-python-embeddable.ps1.")
        return 1

    before = folder_bytes(py_dir)
    print(f"Slim target: {py_dir}")
    print(f"Bundle size before slim: {human_mb(before)}")
    print()

    # 1. Remove specific packages.
    removed_pkg = 0
    print("[1/4] Removing unused packages...")
    for pkg in REMOVABLE_PACKAGES:
        target = site / pkg
        # Also strip the matching *.dist-info / *.egg-info siblings.
        siblings = list(site.glob(f"{pkg}-*.dist-info")) + list(site.glob(f"{pkg}-*.egg-info"))
        if target.exists() or siblings:
            n = rm_tree(target)
            for s in siblings:
                n += rm_tree(s)
            if n > 0:
                print(f"  - {pkg:24s} -{human_mb(n)}")
                removed_pkg += n

    # 2. Recursive __pycache__ + tests purge.
    print()
    print("[2/4] Stripping __pycache__ and tests/ trees...")
    removed_dirs = 0
    for kind in RECURSIVE_DELETE_DIRS:
        n = 0
        # Collect first, then delete -- can't iterate and mutate.
        targets = [p for p in py_dir.rglob(kind) if p.is_dir()]
        for t in targets:
            n += rm_tree(t)
        if n > 0:
            print(f"  - {kind:24s} -{human_mb(n)} ({len(targets)} dirs)")
            removed_dirs += n

    # 3. File globs.
    print()
    print("[3/4] Stripping type stubs and install manifests...")
    removed_files = 0
    for glob in RECURSIVE_DELETE_FILE_GLOBS:
        n = 0
        count = 0
        for f in py_dir.rglob(glob):
            try:
                if f.is_file():
                    n += f.stat().st_size
                    f.unlink()
                    count += 1
            except OSError:
                pass
        if n > 0:
            print(f"  - {glob:24s} -{human_mb(n)} ({count} files)")
            removed_files += n

    # 4. Smoke test -- runs python.exe from the slimmed bundle to check
    #    imports resolve. Skipped against packaged dist trees where the
    #    interpreter's site path resolution can differ.
    if args.skip_smoke_test:
        print()
        print("[4/4] Smoke test skipped (--skip-smoke-test).")
    else:
        print()
        print("[4/4] Smoke-testing the slimmed bundle...")
        import subprocess
        py = py_dir / "python.exe"
        test = subprocess.run(
            [str(py), "-c",
             "import pm4py, pandas, networkx, yaml, docx; "
             "print('pm4py', pm4py.__version__); "
             "print('pandas', pandas.__version__)"],
            capture_output=True, text=True,
        )
        if test.returncode != 0:
            print(f"  SMOKE TEST FAILED:\n{test.stderr}")
            return 1
        print(f"  OK: {test.stdout.strip()}")

    after = folder_bytes(py_dir)
    print()
    print(f"Bundle size after slim:  {human_mb(after)}")
    print(f"Saved:                   {human_mb(before - after)}  "
          f"({(before - after) / before * 100:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
