"""Session-level golden gate (Wave 0 / F2).

Re-normalizes committed reference session(s) and diffs a *lightweight projection*
of the pipeline output against a committed golden. This is the regression gate the
unit suites can't be — it catches "the map/segmentation silently changed" across a
whole session, which is exactly the class of bug that ships past green unit tests.

Why a projection (not the full artifacts): a curated set of stable scalars + the
distinct process-label set + DFG shape diffs cleanly and survives benign churn;
full-artifact verbatim drifts on every timestamp, and pixel diffs are theme-fragile.
(See PDT-ROADMAP-CODEBASE-FIT.md §11.)

The reference input is copied to a temp dir and normalized THERE, so the committed
`sessions/example-aggregate/` demo data is never regenerated in place (CLAUDE.md:
"don't commit the regenerated files").

Usage:
    # check (exit 1 on any drift):
    <python-with-pipeline-deps> normalization/golden_check.py
    # regenerate the goldens after an intended pipeline change:
    <python-with-pipeline-deps> normalization/golden_check.py --update

Run with a Python that has the pipeline deps (pandas / pm4py): the bundled
`viewer/python/python.exe`, or a CI env with `requirements.txt` installed.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
GOLDEN_DIR = os.path.join(HERE, "golden")

# Reference sessions under sessions/example-aggregate/ that the gate pins.
# The full committed demo corpus (10 sessions of the order-to-cash process at
# varying volumes) -- re-normalized on pre-recorded events.jsonl, so the gate
# needs NO recorder and NO Electron in CI (PDT-ROADMAP-CODEBASE-FIT.md §11a,
# narrow tier). See corpus/README.md for the tier roadmap.
REFERENCE_SESSIONS = [
    "sess-2026-0511-0905",
    "sess-2026-0511-1320",
    "sess-2026-0512-0850",
    "sess-2026-0512-1410",
    "sess-2026-0513-0915",
    "sess-2026-0513-1130",
    "sess-2026-0514-0900",
    "sess-2026-0514-1505",
    "sess-2026-0515-0840",
    "sess-2026-0515-1255",
]

# Inputs copied into the temp normalize dir. We copy the analyst sidecar too so any
# manual annotations are honoured; events.jsonl is the immutable raw stream.
_INPUT_FILES = ["events.jsonl", "manifest.json", "annotations.json"]

# stats.json.meta scalars that are stable run-to-run (NO timestamps / absolute paths).
_META_FIELDS = [
    "raw_event_count",
    "dropped_jsonl_lines",
    "collapsed_activity_count",
    "interaction_count",
    "case_count",
    "marker_edits_applied",
    "step_count",
    "step_state_breakdown",
    "app_vocabulary_matches",
]


def _session_src(name: str) -> str:
    return os.path.join(REPO_ROOT, "sessions", "example-aggregate", name)


def build_projection(session_name: str) -> dict:
    """Copy the reference session's inputs to a temp dir, run `normalize --mine`
    there, and return a stable projection of the produced artifacts."""
    src = _session_src(session_name)
    if not os.path.isdir(src):
        raise FileNotFoundError(f"reference session not found: {src}")

    with tempfile.TemporaryDirectory(prefix="pdt-golden-") as tmp:
        for fname in _INPUT_FILES:
            s = os.path.join(src, fname)
            if os.path.exists(s):
                shutil.copy2(s, os.path.join(tmp, fname))

        # Faithful to the §0 harness command: `normalize.py <folder> --mine`,
        # default taxonomy + vocabs, run from the repo root so the relative
        # default paths resolve.
        proc = subprocess.run(
            [sys.executable, os.path.join(HERE, "normalize.py"), tmp, "--mine"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"normalize failed for {session_name} (exit {proc.returncode}):\n"
                f"{proc.stderr[-2000:]}"
            )

        stats = _read_json(os.path.join(tmp, "stats.json")) or {}
        anno = _read_json(os.path.join(tmp, "annotations.json")) or {}
        dfg = _read_json(os.path.join(tmp, "dfg.json")) or {}

    meta = stats.get("meta", {})
    steps = anno.get("steps") or []
    labels = sorted({(s.get("process_label") or "").strip() for s in steps if s.get("process_label")})

    # dfg.json has no explicit node list — nodes are the distinct edge endpoints.
    edges = dfg.get("edges") or []
    nodes = {e.get("source") for e in edges} | {e.get("target") for e in edges}
    nodes.discard(None)

    return {
        "session": session_name,
        "meta": {k: meta.get(k) for k in _META_FIELDS},
        "steps": {"count": len(steps), "process_labels": labels},
        "dfg": {
            "nodes": len(nodes),
            "edges": len(edges),
            "start_activities": len(dfg.get("start_activities") or {}),
            "end_activities": len(dfg.get("end_activities") or {}),
        },
    }


def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _golden_path(session_name: str) -> str:
    return os.path.join(GOLDEN_DIR, f"example-aggregate__{session_name}.projection.json")


def load_golden(session_name: str) -> dict | None:
    return _read_json(_golden_path(session_name))


def diff_projection(actual: dict, golden: dict) -> list[str]:
    """Return a list of human-readable mismatch lines (empty == match)."""
    out: list[str] = []

    def walk(a, g, path):
        if isinstance(g, dict):
            for k in sorted(set(g) | set(a if isinstance(a, dict) else {})):
                walk((a or {}).get(k) if isinstance(a, dict) else None, g.get(k), f"{path}.{k}")
        elif isinstance(g, list):
            ga, aa = g, (a if isinstance(a, list) else [])
            for item in sorted(set(map(_key, ga)) | set(map(_key, aa))):
                in_g, in_a = item in map(_key, ga), item in map(_key, aa)
                if in_g and not in_a:
                    out.append(f"{path}: missing {item!r} (in golden, not produced)")
                elif in_a and not in_g:
                    out.append(f"{path}: unexpected {item!r} (produced, not in golden)")
        else:
            if a != g:
                out.append(f"{path}: produced {a!r} != golden {g!r}")

    walk(actual, golden, "")
    return out


def _key(x):
    return json.dumps(x, sort_keys=True) if isinstance(x, (dict, list)) else x


def check_all(update: bool = False) -> int:
    os.makedirs(GOLDEN_DIR, exist_ok=True)
    failures = 0
    for name in REFERENCE_SESSIONS:
        proj = build_projection(name)
        if update:
            with open(_golden_path(name), "w", encoding="utf-8") as f:
                json.dump(proj, f, indent=2, sort_keys=True)
                f.write("\n")
            print(f"[golden] wrote {name}: {proj['meta']['case_count']} cases, "
                  f"{proj['steps']['count']} steps, {proj['dfg']['nodes']}/{proj['dfg']['edges']} dfg")
            continue
        golden = load_golden(name)
        if golden is None:
            print(f"[golden] MISSING golden for {name} — run with --update")
            failures += 1
            continue
        mismatches = diff_projection(proj, golden)
        if mismatches:
            failures += 1
            print(f"[golden] DRIFT in {name} ({len(mismatches)} mismatch(es)):")
            for m in mismatches:
                print(f"    {m}")
        else:
            print(f"[golden] OK {name}: {proj['meta']['case_count']} cases, "
                  f"{proj['steps']['count']} steps, {proj['dfg']['nodes']}/{proj['dfg']['edges']} dfg")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(check_all(update="--update" in sys.argv[1:]))
