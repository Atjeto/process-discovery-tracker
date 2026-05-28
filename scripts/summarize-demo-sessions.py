"""Print a tight summary of each demo session: cases, steps, waste
mix, efficiency, automation segments, top variants. Run AFTER
generate-demo-sessions.py + normalize."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMOS = ROOT / "sessions" / "_demo"


def _load(p: Path) -> dict | None:
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return {"_load_error": str(e)}


def _fmt_ms(ms):
    if ms is None: return "-"
    s = ms / 1000.0
    if s < 60: return f"{s:.1f}s"
    if s < 3600: return f"{int(s // 60)}m{int(s % 60):02d}s"
    return f"{int(s // 3600)}h{int((s % 3600) // 60):02d}m"


def _ascii(s: str) -> str:
    return s.encode("ascii", "replace").decode("ascii")


def summarize(folder: Path):
    name = folder.name
    print()
    print("=" * 72)
    print("==", name)
    print("=" * 72)

    manifest = _load(folder / "manifest.json") or {}
    stats = _load(folder / "stats.json") or {}
    analysis = _load(folder / "analysis.json") or {}
    annotations = _load(folder / "annotations.json") or {}

    meta = stats.get("meta") or {}
    print("Label             :", manifest.get("label", "-"))
    print("Cases             :", meta.get("case_count", "-"))
    print("Steps             :", meta.get("step_count", "-"))
    print("Raw events parsed :", meta.get("raw_event_count", "-"),
          "(dropped:", meta.get("dropped_jsonl_lines", 0), ")")
    print("Match rate        :", meta.get("match_rate", "-"))

    # --- Efficiency / waste mix ----------------------------------
    eff = analysis.get("efficiency") or {}
    if eff:
        total = eff.get("total_elapsed_ms", 0)
        va = eff.get("total_va_ms", 0)
        bnva = eff.get("total_bnva_ms", 0)
        nva = eff.get("total_nva_ms", 0)
        ratio = eff.get("process_efficiency_ratio", 0) or 0
        print()
        print("Efficiency        : {:.0%}".format(ratio))
        if total:
            print("  VA              :", _fmt_ms(va),
                  f"({va/total:.0%})")
            print("  BNVA (business) :", _fmt_ms(bnva),
                  f"({bnva/total:.0%})")
            print("  NVA (waste)     :", _fmt_ms(nva),
                  f"({nva/total:.0%})")
            print("  Stepped time    :", _fmt_ms(total))

    # --- Waste type breakdown ------------------------------------
    waste_rows = analysis.get("waste_classification") or []
    if waste_rows:
        wtypes = {}
        for w in waste_rows:
            for t in (w.get("waste_types") or []):
                wtypes[t] = wtypes.get(t, 0) + 1
        if wtypes:
            print()
            print("Waste signal      :", ", ".join(
                f"{k}({v})" for k, v in sorted(wtypes.items(),
                                               key=lambda kv: -kv[1])))

    # --- Automation segments (ADR-0016) --------------------------
    auto = analysis.get("automation_candidates") or []
    if auto:
        print()
        print("Automation segments (ADR-0016):")
        for a in auto:
            sig = a.get("data_sufficiency", "?")
            label = _ascii(a.get("label", "(segment)"))
            print(f"  [{sig:16s}] {label[:80]}")
            print(f"      {a.get('instance_count', 0)}x inst | "
                  f"total {_fmt_ms(a.get('total_elapsed_ms', 0))} | "
                  f"mean {_fmt_ms(a.get('mean_elapsed_ms', 0))}")

    segs = analysis.get("segments") or []
    if segs:
        print(f"Raw segments      : {len(segs)} detected")

    # --- Variants ------------------------------------------------
    tv = stats.get("trace_variants") or []
    sv = stats.get("step_variants") or []
    if tv:
        print()
        print(f"Activity variants : {len(tv)} distinct")
        for v in tv[:5]:
            arr = " > ".join(v.get("variant", []))
            print(f"  {v.get('frequency', 0)}x: {_ascii(arr)[:80]}")
    if sv:
        print(f"Step variants     : {len(sv)} distinct")
        for v in sv[:5]:
            arr = " > ".join(v.get("variant", []))
            print(f"  {v.get('frequency', 0)}x: {_ascii(arr)[:80]}")

    # --- Cases ---------------------------------------------------
    cs = stats.get("case_stats") or []
    if cs:
        # Only the labelled top-level cases.
        top = [c for c in cs if not c.get("parent_case_id")]
        durs = [c.get("active_ms") or c.get("wall_clock_ms") or 0 for c in top]
        if durs:
            durs.sort()
            print()
            print(f"Case durations    : min {_fmt_ms(durs[0])}, "
                  f"median {_fmt_ms(durs[len(durs)//2])}, "
                  f"max {_fmt_ms(durs[-1])}")

    # --- Rework loops --------------------------------------------
    rew = stats.get("rework_loops") or []
    if rew:
        print()
        print("Rework loops detected:")
        for r in rew[:5]:
            print(f"  {r.get('rework_count', '?')}x: "
                  f"{_ascii(str(r.get('activity_label', '?')))[:80]}")


def main():
    if not DEMOS.exists():
        print("No demo sessions; run generate-demo-sessions.py first.",
              file=sys.stderr)
        sys.exit(1)
    for folder in sorted(DEMOS.iterdir()):
        if folder.is_dir():
            summarize(folder)


if __name__ == "__main__":
    main()
