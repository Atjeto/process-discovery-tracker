"""Run every scenario in the test suite, with the appropriate normalize
environment (vocab), then assert outcomes and emit a markdown
report at scripts/test-suite-report.md.

Run from the repo root, after generate-test-suite.py:
    viewer/python/python.exe scripts/run-test-suite.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE = ROOT / "sessions" / "_testsuite"
ASSETS = ROOT / "scripts" / "test-suite-assets"
REPORT = ROOT / "scripts" / "test-suite-report.md"
PY = ROOT / "viewer" / "python" / "python.exe"
NORMALIZE = ROOT / "normalization" / "normalize.py"

# Each test row: (test_id, folder_relative_to_SUITE, extra_normalize_args,
# env_vars, assertion_fn). The assertion_fn returns (ok: bool,
# evidence_string).


# --- helpers ----------------------------------------------------------

def _load(folder: Path, name: str) -> dict:
    p = folder / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _events(folder: Path) -> list[dict]:
    out = []
    p = folder / "events.jsonl"
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


# --- assertions per test ---------------------------------------------

def a_vocab_off(folder):
    """The default vocab dir (sample-salesforce, sample-outlook) is
    ALWAYS loaded and may legitimately enrich some interactions. The
    test-crm vocab is the one we control -- it must NOT have fired in
    this session, since we didn't point PDT_APP_VOCABULARIES at it."""
    stats = _load(folder, "stats.json")
    meta = stats.get("meta") or {}
    hits_by_id = meta.get("app_vocabulary_hits_by_id") or {}
    ok = "test-crm" not in hits_by_id
    return ok, (
        f"vocab_hits_by_id={hits_by_id} (test-crm should be absent)"
    )


def a_vocab_on(folder):
    """With the test-crm vocab loaded via PDT_APP_VOCABULARIES, the
    session's unique `testCrmExclusiveBusinessUnit` interactions should
    be enriched. test-crm must appear in hits_by_id with hits >= 3
    (one per case). Raw events.jsonl is append-only and never rewritten
    with enrichment -- the enrichment is in-memory in the normalize
    pipeline, surfaced through stats.json.meta and the events.csv /
    events.xes exports."""
    stats = _load(folder, "stats.json")
    meta = stats.get("meta") or {}
    hits_by_id = meta.get("app_vocabulary_hits_by_id") or {}
    test_crm_hits = hits_by_id.get("test-crm", 0)
    loaded_ids = {v.get("id") for v in (meta.get("app_vocabularies") or [])}
    ok = "test-crm" in loaded_ids and test_crm_hits >= 3
    return ok, (
        f"vocabs loaded={sorted(loaded_ids)}, "
        f"vocab_hits_by_id={hits_by_id}"
    )


def a_agg_basic_count(expected_min, expected_max=None):
    def _check(folder):
        stats = _load(folder, "stats.json")
        meta = stats.get("meta") or {}
        n = meta.get("case_count")
        ok_n = (n is not None and n >= expected_min
                and (expected_max is None or n <= expected_max))
        return ok_n, f"case_count={n} (expected {expected_min}{'-' + str(expected_max) if expected_max else '+'})"
    return _check


def a_empty(folder):
    """Empty session: should normalize without crashing; case_count = 0;
    no analysis.json (since no steps); 0 dropped lines."""
    stats = _load(folder, "stats.json")
    meta = stats.get("meta") or {}
    analysis_exists = (folder / "analysis.json").exists()
    ok = (meta.get("case_count", 0) == 0
          and meta.get("step_count", 0) == 0
          and meta.get("dropped_jsonl_lines", 0) == 0
          and not analysis_exists)
    return ok, (
        f"case_count={meta.get('case_count')}, step_count={meta.get('step_count')}, "
        f"dropped={meta.get('dropped_jsonl_lines')}, analysis.json={analysis_exists}"
    )


def a_noise_only(folder):
    """Noise-only: no markers => no cases; no interactions => no steps.
    The activity stream still registers (and shows up as 'Unclassified'
    in activity_stats since no taxonomy is loaded). The pipeline must
    not crash."""
    stats = _load(folder, "stats.json")
    meta = stats.get("meta") or {}
    ann = _load(folder, "annotations.json")
    steps = ann.get("steps", [])
    activity = stats.get("activity_stats") or []
    apps = {(a.get("activity_label") or "").rsplit(" -- ", 1)[-1] for a in activity}
    analysis = (folder / "analysis.json").exists()
    ok = (meta.get("case_count", 0) == 0
          and len(steps) == 0
          and "obs64.exe" in str(apps)
          and not analysis)             # no steps -> no analysis.json (ADR-0008)
    return ok, (
        f"case_count={meta.get('case_count')}, steps={len(steps)}, "
        f"activity apps={sorted(apps)[:5]}, analysis.json={analysis}"
    )


def a_step_analytics(folder):
    """6 identical cases: at least one step type should appear in
    step_stats with frequency = 6 (proves cross-case rollup). The
    auto-namer keys per-case values into some step names (so two cases
    may yield slightly different sequences for `step_variants`); what
    we care about is that step_stats COLLAPSES instances of the SAME
    step type, which it does via process_label."""
    stats = _load(folder, "stats.json")
    ss = stats.get("step_stats") or []
    sv = stats.get("step_variants") or []
    freq6 = [r for r in ss if r.get("frequency") == 6]
    total_variant_freq = sum(v.get("frequency", 0) for v in sv)
    ok = len(freq6) >= 3 and total_variant_freq == 6
    return ok, (
        f"step_stats rows={len(ss)} (freq=6 rows: {len(freq6)}), "
        f"step_variants={len(sv)} (total freq={total_variant_freq}, "
        f"covering all 6 cases)"
    )


# --- the test table ---------------------------------------------------

TESTS = [
    # (id, folder, extra args, env, assertion, description)
    ("T03a", "03a-vocab-off", [], {}, a_vocab_off,
     "App-vocab disabled: no meaningful_name on interactions"),
    ("T03b", "03b-vocab-on", [], {"PDT_APP_VOCABULARIES": str(ASSETS / "vocab")},
     a_vocab_on,
     "App-vocab enabled: meaningful_name + vocab_source on matching interactions"),
    ("T04",  "04-agg-1-session", [], {}, a_agg_basic_count(1),
     "Aggregation: 1-session degenerate case still normalizes"),
] + [
    # Normalize every one of the 10 aggregation-member sessions so the
    # Compare-Sessions test (T11) sees all 10 as "normalized".
    (f"T05.{i:02d}", f"05-agg-10-sessions/sess-{i:02d}", [], {},
     a_agg_basic_count(1),
     f"10-sessions agg: each session normalizes (sess-{i:02d})")
    for i in range(1, 11)
] + [
    ("T06a", "06-agg-mixed-unrelated/01-onboarding", [], {}, a_agg_basic_count(2),
     "Mixed agg member: onboarding session (CRM)"),
    ("T06b", "06-agg-mixed-unrelated/02-atm-tickets", [], {}, a_agg_basic_count(2),
     "Mixed agg member: ATM-ticket session (unrelated)"),
    ("T06c", "06-agg-mixed-unrelated/03-notes", [], {}, a_agg_basic_count(1),
     "Mixed agg member: Notepad-only session (single doc)"),
    ("T07",  "07-empty", [], {}, a_empty,
     "Empty session: pipeline must produce empty-shape outputs without crashing"),
    ("T08",  "08-noise-only", [], {}, a_noise_only,
     "Noise-only session: no markers, no value-bearing interactions -> 0 cases/steps"),
    ("T09",  "09-step-analytics", [], {}, a_step_analytics,
     "Step analytics: 6 identical cases collapse to 1 dominant step variant"),
]


def normalize(folder: Path, extra: list[str], env: dict[str, str]) -> tuple[bool, str]:
    """Run normalize.py --mine for `folder`. Returns (succeeded, last_tail)."""
    args = [str(PY), str(NORMALIZE), str(folder), "--mine"] + extra
    pe = dict(os.environ)
    pe.update(env)
    p = subprocess.run(args, capture_output=True, text=True, env=pe)
    return p.returncode == 0, (p.stderr or "")[-400:]


def main():
    if not SUITE.exists():
        print("no test suite generated; run generate-test-suite.py first",
              file=sys.stderr)
        sys.exit(1)
    rows = []
    for (tid, rel, extra, env, fn, desc) in TESTS:
        folder = SUITE / rel
        if not folder.exists():
            rows.append((tid, desc, "FAIL", "no such folder", ""))
            continue
        ok, tail = normalize(folder, extra, env)
        if not ok:
            rows.append((tid, desc, "FAIL",
                         "normalize crashed", tail.replace("\n", " | ")[:200]))
            continue
        passed, evidence = fn(folder)
        rows.append((tid, desc, "PASS" if passed else "FAIL",
                     evidence, ""))

    # --- report ---
    out = ["# Test Suite Results",
           "",
           "Generated by `scripts/run-test-suite.py` on top of the sessions in "
           "`sessions/_testsuite/`.",
           "",
           "| ID | Test case | Outcome | Evidence | Notes |",
           "|---|---|---|---|---|"]
    for (tid, desc, outcome, evidence, note) in rows:
        ev = evidence.replace("|", "\\|")
        nt = (note or "").replace("|", "\\|")
        out.append(f"| {tid} | {desc} | **{outcome}** | {ev} | {nt} |")
    out.append("")
    REPORT.write_text("\n".join(out), encoding="utf-8")
    passed = sum(1 for r in rows if r[2] == "PASS")
    failed = len(rows) - passed
    print(f"{passed}/{len(rows)} PASS")
    for r in rows:
        print(f"  {r[0]:6s} {r[2]:4s}  {r[1][:60]}")
    print("report:", REPORT)
    return failed


if __name__ == "__main__":
    # Exit non-zero when any row is not PASS so this is a real CI gate, not a
    # green-on-failure no-op.
    sys.exit(1 if main() else 0)
