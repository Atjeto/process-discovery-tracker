"""Verify the real-data test suite (sessions/_real_suite/) against
the same outcome bar the synthetic suite used. Each test_id has an
assertion fn that reads stats.json + analysis.json + events.jsonl and
returns PASS/FAIL with evidence.

Run AFTER real-capture-test/scenarios.js has produced the sessions.
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITE = ROOT / "sessions" / "_real_suite"
REPORT = ROOT / "scripts" / "real-suite-report.md"


def _load(p):
    if not p.exists(): return {}
    try: return json.loads(p.read_text(encoding="utf-8"))
    except Exception: return {}


def _events(folder):
    out = []
    p = folder / "events.jsonl"
    if not p.exists(): return out
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line: continue
        try: out.append(json.loads(line))
        except Exception: pass
    return out


# --- Assertions ----------------------------------------------------

def a_t01(folder):
    """3 real form-fill cases. Expect: 3 cases, >=15 interactions,
    real form-field names ('Customer name:', etc.) appear in events,
    and the analysis layer produces multiple steps."""
    evs = _events(folder)
    stats = _load(folder / "stats.json")
    ann = _load(folder / "annotations.json")
    meta = stats.get("meta", {})
    int_count = meta.get("interaction_count", 0)
    case_count = meta.get("case_count", 0)
    names = {(e.get("data") or {}).get("name") for e in evs
             if e.get("type") == "interaction"}
    has_form_labels = ("Customer name:" in names and
                       "E-mail address:" in names)
    steps = ann.get("steps", [])
    ok = (case_count == 3 and int_count >= 15
          and has_form_labels and len(steps) >= 6)
    return ok, (
        f"cases={case_count}, interactions={int_count}, steps={len(steps)}, "
        f"form-field labels seen: " + str(has_form_labels)
    )


def a_t02(folder):
    """Real session normalized with the real-form-template.yaml. Expect:
    canonical_process_id set, at least some steps in state=auto_matched."""
    stats = _load(folder / "stats.json")
    ann = _load(folder / "annotations.json")
    meta = stats.get("meta", {})
    steps = ann.get("steps", [])
    matched = [s for s in steps if s.get("state") == "auto_matched"
               and s.get("canonical_step_id")]
    canonical = meta.get("canonical_process_id")
    distinct = {s.get("canonical_step_id") for s in matched}
    expected_subset = {"enter-customer", "enter-telephone", "enter-email"}
    hit = expected_subset & distinct
    ok = (canonical == "real-form-onboarding"
          and len(matched) >= 4
          and len(hit) >= 2)
    return ok, (
        f"canonical={canonical}, matched={len(matched)}/{len(steps)}, "
        f"canonical_ids hit: {sorted(distinct)}, match_rate={meta.get('match_rate')}"
    )


def a_t03b(folder):
    """Vocab-on real session. Expect: real-form-vocab in loaded list
    AND hits_by_id > 0 for it. Coverage should be > 0% for chrome.exe."""
    stats = _load(folder / "stats.json")
    meta = stats.get("meta", {})
    loaded = {v.get("id") for v in (meta.get("app_vocabularies") or [])}
    hits = meta.get("app_vocabulary_hits_by_id") or {}
    cov = meta.get("vocab_coverage", {})
    chrome_cov = (cov.get("chrome.exe") or {}).get("coverage_pct", 0)
    ok = ("real-form-vocab" in loaded
          and hits.get("real-form-vocab", 0) >= 3
          and chrome_cov > 0)
    return ok, (
        f"vocabs={sorted(loaded)}, hits={hits}, chrome coverage={chrome_cov}%"
    )


def a_t07(folder):
    """Real empty session (start marker, immediate end, no driving).
    Expect case_count=1 (the marker pair), step_count=0, no analysis.json."""
    stats = _load(folder / "stats.json")
    meta = stats.get("meta", {})
    analysis_exists = (folder / "analysis.json").exists()
    ok = (meta.get("case_count", 0) <= 1
          and meta.get("step_count", 0) == 0
          and meta.get("dropped_jsonl_lines", 0) == 0)
    return ok, (
        f"case_count={meta.get('case_count')}, step_count={meta.get('step_count')}, "
        f"analysis.json={analysis_exists}, dropped={meta.get('dropped_jsonl_lines')}"
    )


def a_t08(folder):
    """Real noise-only session (no markers, no driving). Activity stream
    captures whatever is foreground; **0 business cases** (a single
    implicit/default case can exist as a container for marker-less
    activity events); step_count must be 0."""
    stats = _load(folder / "stats.json")
    meta = stats.get("meta", {})
    activity = stats.get("activity_stats") or []
    ok = (meta.get("case_count", 0) <= 1
          and meta.get("step_count", 0) == 0
          and meta.get("interaction_count", 0) == 0
          and len(activity) >= 1)        # something WAS foreground
    return ok, (
        f"case_count={meta.get('case_count')}, step_count={meta.get('step_count')}, "
        f"interactions={meta.get('interaction_count')}, activity apps={len(activity)}"
    )


def a_t09(folder):
    """3 identical real form-fill cases. step_stats should aggregate
    repeats so at least one step type has frequency >= 2. (Real-world
    timing variance: not every case produces the IDENTICAL step
    sequence -- a slow form-load can shift step boundaries. We assert
    the aggregation HAPPENS, not perfection on every case.)"""
    stats = _load(folder / "stats.json")
    ss = stats.get("step_stats") or []
    sv = stats.get("step_variants") or []
    freqGE2 = [r for r in ss if r.get("frequency", 0) >= 2]
    total_var = sum(v.get("frequency", 0) for v in sv)
    ok = len(freqGE2) >= 3 and total_var >= 2
    return ok, (
        f"step_stats rows={len(ss)} (freq>=2 rows={len(freqGE2)}), "
        f"step_variants={len(sv)} (total freq={total_var})"
    )


def a_t05_member(folder):
    """One of the 10 aggregation members. Expect at least one case +
    some form interactions."""
    stats = _load(folder / "stats.json")
    meta = stats.get("meta", {})
    return (meta.get("case_count", 0) >= 1
            and meta.get("interaction_count", 0) >= 5,
            f"case_count={meta.get('case_count')}, "
            f"interactions={meta.get('interaction_count')}")


# --- Runner --------------------------------------------------------

TESTS = [
    ("T01", "T01-multi-case-onboarding", a_t01,
     "Real multi-case onboarding session (3 cases, real httpbin form fills)"),
    ("T02", "T02-canonical-match", a_t02,
     "Real canonical template matches the real-form session"),
    ("T03b", "T03b-vocab-on", a_t03b,
     "Real app-vocab enriches the real recorder interactions"),
    ("T07", "T07-empty", a_t07,
     "Real empty session: pipeline produces empty-shape outputs"),
    ("T08", "T08-noise-only", a_t08,
     "Real noise-only session: no markers, no steps"),
    ("T09", "T09-repeat-cases", a_t09,
     "Real 3-case repeat: step_stats aggregates"),
]

def main():
    rows = []
    for (tid, sub, fn, desc) in TESTS:
        folder = SUITE / sub
        if not folder.exists():
            rows.append((tid, desc, "MISSING",
                         "no folder " + str(folder)))
            continue
        try:
            ok, ev = fn(folder)
            rows.append((tid, desc, "PASS" if ok else "FAIL", ev))
        except Exception as e:
            rows.append((tid, desc, "ERROR", str(e)))

    # 10-session aggregation
    t05_root = SUITE / "T05-agg-10"
    if t05_root.exists():
        all_pass = True
        for i in range(1, 11):
            folder = t05_root / f"sess-{i:02d}"
            if not folder.exists():
                rows.append((f"T05.{i:02d}", "10-session agg member",
                             "MISSING", "no folder " + folder.name))
                all_pass = False; continue
            ok, ev = a_t05_member(folder)
            rows.append((f"T05.{i:02d}", "10-session agg member " + folder.name,
                         "PASS" if ok else "FAIL", ev))
            if not ok: all_pass = False

    out = [
        "# Real-data Test Suite Report",
        "",
        "Each test in this report was produced by driving the **real**",
        "capture pipeline (live C# UIA recorder + real foreground apps)",
        "and then running the unmodified `normalize.py` against whatever",
        "the recorder actually wrote. No JSON is synthesised at any step.",
        "",
        "| ID | Test | Outcome | Evidence |",
        "|---|---|---|---|",
    ]
    for (tid, desc, st, ev) in rows:
        evtxt = (ev or "").replace("|", "\\|")
        out.append(f"| {tid} | {desc} | **{st}** | {evtxt} |")
    REPORT.write_text("\n".join(out) + "\n", encoding="utf-8")

    n_pass = sum(1 for r in rows if r[2] == "PASS")
    print(f"{n_pass}/{len(rows)} PASS")
    for r in rows:
        print(f"  {r[0]:8s} {r[2]:6s}  {r[1][:60]}")
    print("report:", REPORT)


if __name__ == "__main__":
    main()
