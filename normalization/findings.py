"""Findings detector library (lab-phase spec §A3).

Produces `analysis.findings[]` -- the claims the consultant's memo and
the viewer's Overview feed render. Every claim is COMPARATIVE/FACTUAL,
never normative: "31% of foreground time is in X", not "too much X".
The analyst supplies the judgment; the detector supplies the measured
sentence plus the evidence to check it.

Each finding:

    {
      "id": "<detector>-<12hex>",        # stable across re-runs
      "detector": "screen_time_sink",
      "claim": "...",                     # templated sentence, measured numbers
      "evidence": { ...numbers,
                    "step_ids": [...], "event_ids": [...],
                    "screenshot_refs": [...] },
      "tier": 1 | 2,                      # honesty tier (1 = no cases needed)
      "confidence_note": "..."            # how the number was measured / its limits
    }

Detectors fire only when their preconditions hold; each runs in its own
try/except so one detector edge case never costs the rest (the analysis
layer's standing posture). `variant_divergence` from the spec table lives
viewer-side (`viewer/variant-divergence.js`, lab-phase §D1): it needs >= 2
LOADED sessions, so it runs in the Compare surface's in-memory aggregate
payload, never in a single session's analysis.json.

Pure stdlib.
"""
from __future__ import annotations

import hashlib
from typing import Any

from _dt import parse_ts_or_none as _parse_ts
from facts import rekey_details

# Findings are capped so the feed stays a readable shortlist, not a log.
MAX_BOUNCE_FINDINGS = 3
MAX_REPETITION_FINDINGS = 3

# B4 (lab-phase spec): repetition claims render a SHORT segment label --
# the full "app — s1 → s2 → s3 → s4 → s5 …" narrative label overflows a
# memo sentence. Cap ~60 chars; the full label stays in the evidence.
SEGMENT_LABEL_MAX = 60

# Per-app trust: coverage_hint values that mark reduced capture fidelity
# (§11e). A remote/terminal framework is the capture "wall" -- the field
# data is a proxy for pixels.
_REDUCED_HINTS = {"basic", "minimal"}
_WALL_FRAMEWORKS = {"remote", "terminal", "rdp", "citrix"}
_LOW_CONFIDENCE_MEAN = 0.5


def _fid(detector: str, *parts: Any) -> str:
    raw = "\x1f".join([detector] + [str(p) for p in parts])
    return detector + "-" + hashlib.blake2b(
        raw.encode("utf-8"), digest_size=6).hexdigest()


def _fmt_ms(ms: float | int | None) -> str:
    """Compact human duration for claim sentences ("1h 12m", "3m 40s", "12s")."""
    ms = ms or 0
    s = int(round(ms / 1000.0))
    if s < 60:
        return f"{s}s"
    m, s = divmod(s, 60)
    if m < 60:
        return f"{m}m {s:02d}s" if s else f"{m}m"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m"


def _pct(x: float) -> str:
    return f"{round((x or 0) * 100)}%"


def short_segment_label(app: Any, step_labels: list | tuple | None,
                        max_len: int = SEGMENT_LABEL_MAX) -> str:
    """'<app> — first 2 steps … (+N more)' capped at ~`max_len` chars
    (lab-phase B4). Degrades to 1 step, then a hard truncation, so the
    cap holds even for pathological step names. The FULL label is never
    lost -- it lives in the finding's evidence detail."""
    app = str(app or "").strip()
    if app.lower().endswith(".exe"):
        app = app[:-4]
    app = app or "one app"
    labels = [str(s).strip() for s in (step_labels or []) if str(s).strip()]
    if not labels:
        return app[:max_len]
    for take in (2, 1):
        shown = labels[:take]
        extra = len(labels) - take
        out = app + " — " + " → ".join(shown)
        if extra > 0:
            out += f" … (+{extra} more)"
        if len(out) <= max_len:
            return out
    # Even a single step overflows: hard-cap the head, keep the count tail.
    extra = len(labels) - 1
    tail = f" … (+{extra} more)" if extra > 0 else ""
    keep = max(1, max_len - len(tail) - 1)
    return (app + " — " + labels[0])[:keep] + "…" + tail


def _screenshots_between(events: list[dict], start_iso: str, end_iso: str,
                         limit: int = 2) -> list[str]:
    """Screenshot paths captured inside [start, end] -- the memo's starred
    evidence pointers. Empty when the window has none."""
    a = _parse_ts(start_iso)
    b = _parse_ts(end_iso)
    if a is None or b is None or b < a:
        return []
    out: list[str] = []
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "system":
            continue
        data = ev.get("data") or {}
        if data.get("kind") != "screenshot" or not data.get("path"):
            continue
        t = _parse_ts(ev.get("timestamp"))
        if t is None or t < a or t > b:
            continue
        out.append(str(data["path"]))
        if len(out) >= limit:
            break
    return out


def _top_app_longest_run(events: list[dict], app: str) -> tuple[str, str] | None:
    """(start_iso, end_iso) of the longest contiguous activity run in `app`.
    The run's end covers the last event's measured duration, so a
    screenshot taken mid-stretch falls inside the window."""
    from datetime import timedelta
    best: tuple[float, str, str] | None = None
    run_ms = 0.0
    run_start: str | None = None
    prev_app = None
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "activity":
            continue
        data = ev.get("data") or {}
        a = (data.get("app") or "").strip() or "(unknown)"
        dur = data.get("duration_ms")
        dur = float(dur) if isinstance(dur, (int, float)) and not isinstance(dur, bool) and dur > 0 else 0.0
        if a == app:
            if prev_app != app:
                run_ms = 0.0
                run_start = ev.get("timestamp")
            run_ms += dur
            end_iso = ev.get("timestamp") or ""
            t = _parse_ts(end_iso)
            if t is not None and dur:
                end_iso = (t + timedelta(milliseconds=dur)).isoformat()
            if best is None or run_ms > best[0]:
                best = (run_ms, run_start or "", end_iso)
        prev_app = a
    if best is None:
        return None
    return best[1], best[2]


# ---------------------------------------------------------------------------
# Detectors. Each returns a list of findings (possibly empty).

def _detect_screen_time_sink(events, facts) -> list[dict]:
    top = (facts.get("top_apps") or [])
    active = facts.get("active_ms") or 0
    if not top or active <= 0:
        return []
    lead = top[0]
    refs: list[str] = []
    run = _top_app_longest_run(events, lead["app"])
    if run:
        refs = _screenshots_between(events, run[0], run[1])
    claim = (f"{lead['app']} accounts for {_pct(lead['share'])} of measured "
             f"foreground time ({_fmt_ms(lead['ms'])} of {_fmt_ms(active)}).")
    return [{
        "id": _fid("screen_time_sink", lead["app"]),
        "detector": "screen_time_sink",
        "claim": claim,
        "evidence": {
            "app": lead["app"],
            "foreground_ms": lead["ms"],
            "share": lead["share"],
            "active_ms": active,
            "top_apps": top,
            "screenshot_refs": refs,
        },
        "tier": 1,
        "confidence_note": "Foreground-window time summed from focus events; "
                           "it includes in-window pauses the recorder did not "
                           "flag as idle.",
    }]


def _detect_fragmentation(facts) -> list[dict]:
    switches = facts.get("app_switches") or 0
    active = facts.get("active_ms") or 0
    if switches <= 0 or active <= 0:
        return []
    mean_dwell = active / (switches + 1)
    claim = (f"Focus moved between apps {switches} times "
             f"({facts.get('switches_per_hour') or 0}/h); the mean unbroken "
             f"stretch in one app was {_fmt_ms(mean_dwell)}, the longest "
             f"{_fmt_ms(facts.get('longest_focus_ms'))}.")
    return [{
        "id": _fid("fragmentation", switches),
        "detector": "fragmentation",
        "claim": claim,
        "evidence": {
            "app_switches": switches,
            "switches_per_hour": facts.get("switches_per_hour") or 0,
            "mean_dwell_ms": round(mean_dwell),
            "longest_focus_ms": facts.get("longest_focus_ms") or 0,
        },
        "tier": 1,
        "confidence_note": "A switch is a foreground-window change; switches "
                           "faster than the recorder's batching window may "
                           "merge into one.",
    }]


def _detect_waiting(facts, analysis_blocks) -> list[dict]:
    idle = facts.get("idle_ms") or 0
    waiting_in_steps = 0
    for row in (analysis_blocks or {}).get("time_study") or []:
        w = row.get("waiting_ms")
        if isinstance(w, (int, float)) and not isinstance(w, bool) and w > 0:
            waiting_in_steps += w
    if idle <= 0 and waiting_in_steps <= 0:
        return []
    if waiting_in_steps > 0:
        claim = (f"{_fmt_ms(idle)} of measured idle time in the session; "
                 f"{_fmt_ms(waiting_in_steps)} of it fell inside annotated steps.")
    else:
        claim = f"{_fmt_ms(idle)} of measured idle time in the session."
    return [{
        "id": _fid("waiting", idle, round(waiting_in_steps)),
        "detector": "waiting",
        "claim": claim,
        "evidence": {
            "idle_ms": idle,
            "waiting_in_steps_ms": round(waiting_in_steps),
        },
        "tier": 1,
        "confidence_note": "Idle is recorder-flagged input inactivity; waiting "
                           "for a slow system while moving the mouse is not "
                           "counted.",
    }]


def _detect_repetition(analysis_blocks) -> list[dict]:
    cands = [
        c for c in ((analysis_blocks or {}).get("automation_candidates") or [])
        if isinstance(c, dict) and c.get("data_sufficiency") == "multi_instance"
    ]
    if not cands:
        return []
    # Segment rows carry the same signature under the key "signature";
    # pool step_ids across every instance of the candidate's signature.
    step_ids_by_sig: dict[str, list] = {}
    for s in (analysis_blocks or {}).get("segments") or []:
        if isinstance(s, dict) and s.get("signature"):
            step_ids_by_sig.setdefault(s["signature"], []).extend(
                sid for sid in (s.get("step_ids") or []) if sid)
    out = []
    for c in cands[:MAX_REPETITION_FINDINGS]:
        step_ids = step_ids_by_sig.get(c.get("segment_signature")) or []
        # B4: the claim sentence carries the SHORT label (app + first 2 steps,
        # ~60 chars); the full narrative label stays in the evidence detail.
        short = short_segment_label(c.get("app"), c.get("step_labels"))
        claim = (f"The segment \"{short}\" was "
                 f"performed {c.get('instance_count') or 0} times, totalling "
                 f"{_fmt_ms(c.get('total_elapsed_ms'))} "
                 f"(mean {_fmt_ms(c.get('mean_elapsed_ms'))} per instance).")
        out.append({
            "id": _fid("repetition", c.get("segment_signature")),
            "detector": "repetition",
            "claim": claim,
            "evidence": {
                "segment_signature": c.get("segment_signature"),
                "label": c.get("label"),
                "short_label": short,
                "app": c.get("app"),
                "instance_count": c.get("instance_count") or 0,
                "total_elapsed_ms": c.get("total_elapsed_ms") or 0,
                "mean_elapsed_ms": c.get("mean_elapsed_ms") or 0,
                "step_labels": c.get("step_labels") or [],
                "step_ids": step_ids,
            },
            "tier": 2,
            "confidence_note": "Counts repeats of the same ordered step "
                               "sequence within one app across cases; a "
                               "near-miss with an extra step counts as a "
                               "different segment.",
        })
    return out


def _detect_backtracking(steps, bounces) -> list[dict]:
    if not steps or not bounces:
        return []
    out = []
    for b in bounces[:MAX_BOUNCE_FINDINGS]:
        occurrences = b.get("occurrences") or []
        step_ids = [sid for occ in occurrences for sid in (occ.get("step_ids") or [])][:30]
        n = b.get("count") or 0
        claim = (f"The flow returned to \"{b.get('returned_to')}\" immediately "
                 f"after \"{b.get('via')}\" {n} time{'s' if n != 1 else ''} "
                 f"(A→B→A).")
        out.append({
            "id": _fid("backtracking", b.get("bounce_id")),
            "detector": "backtracking",
            "claim": claim,
            "evidence": {
                "labels": b.get("labels") or [],
                "count": n,
                "step_ids": step_ids,
                "first_occurrence_ts": (occurrences[0].get("start_ts") if occurrences else ""),
            },
            "tier": 1,
            "confidence_note": "Read from the ordered step labels; an "
                               "intentional check-back reads the same as "
                               "rework -- verify on the timeline.",
        })
    return out


def _detect_rekey_transfer(events) -> list[dict]:
    rows = rekey_details(events)
    if not rows:
        return []
    top = rows[0]
    apps = ", ".join(top["apps"])
    claim = (f"{len(rows)} distinct value{'s were' if len(rows) != 1 else ' was'} "
             f"typed into 2+ different apps -- e.g. \"{top['value']}\" was "
             f"entered in {apps} ({top['entry_count']} typings).")
    return [{
        "id": _fid("rekey_transfer", len(rows), top["value"]),
        "detector": "rekey_transfer",
        "claim": claim,
        "evidence": {
            "rekey_count": len(rows),
            "values": [
                {"value": r["value"], "apps": r["apps"],
                 "entry_count": r["entry_count"],
                 # C1: the vocab-named fields the value moved between (empty
                 # when no vocab named them) -- lets the memo/export say
                 # "Customer ID <-> Account number" instead of raw ids.
                 "fields": r.get("fields") or []}
                for r in rows[:3]
            ],
            "event_ids": top["event_ids"][:20],
        },
        "tier": 1,
        "confidence_note": "Matched by exact value equality on the derived "
                           "stream (masked values compare by token); a "
                           "copy-paste transfer that never re-types does not "
                           "appear here.",
    }]


def _detect_coverage_caveat(events) -> list[dict]:
    per_app: dict[str, dict[str, Any]] = {}
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        data = ev.get("data") or {}
        app = (data.get("process_name") or "").strip()
        if not app:
            continue
        rec = per_app.setdefault(app, {"hints": set(), "frameworks": set(),
                                       "confidences": []})
        hint = data.get("coverage_hint")
        if isinstance(hint, str) and hint:
            rec["hints"].add(hint.lower())
        fw = data.get("framework")
        if isinstance(fw, str) and fw:
            rec["frameworks"].add(fw.lower())
        conf = data.get("confidence")
        if isinstance(conf, (int, float)) and not isinstance(conf, bool):
            rec["confidences"].append(float(conf))

    flagged = []
    for app, rec in sorted(per_app.items()):
        wall = bool(rec["frameworks"] & _WALL_FRAMEWORKS)
        reduced_hint = bool(rec["hints"] & _REDUCED_HINTS)
        mean_conf = (sum(rec["confidences"]) / len(rec["confidences"])
                     if rec["confidences"] else None)
        low_conf = mean_conf is not None and mean_conf < _LOW_CONFIDENCE_MEAN
        if not (wall or reduced_hint or low_conf):
            continue
        if wall:
            tier_label = "wall"
            why = "remote/terminal surface -- captured fields proxy for pixels"
        elif reduced_hint:
            tier_label = sorted(rec["hints"] & _REDUCED_HINTS)[0]
            why = ("no stable control ids" if tier_label == "basic"
                   else "window-level identity only")
        else:
            tier_label = "low-confidence"
            why = f"mean element confidence {round(mean_conf, 2)}"
        flagged.append({
            "app": app,
            "trust": tier_label,
            "why": why,
            "mean_confidence": round(mean_conf, 2) if mean_conf is not None else None,
        })
    if not flagged:
        return []
    total_apps = len(per_app)
    listing = "; ".join(f"{f['app']} ({f['trust']} -- {f['why']})" for f in flagged[:4])
    claim = (f"Capture confidence is reduced in {len(flagged)} of "
             f"{total_apps} apps: {listing}.")
    return [{
        "id": _fid("coverage_caveat", *(f["app"] for f in flagged)),
        "detector": "coverage_caveat",
        "claim": claim,
        "evidence": {
            "flagged_apps": flagged,
            "total_apps": total_apps,
        },
        "tier": 1,
        "confidence_note": "Derived from the per-interaction capture-"
                           "confidence fields (§11e); numbers measured "
                           "inside these apps rest on weaker element identity.",
    }]


# ---------------------------------------------------------------------------
# Entry point

def detect_findings(
    events: list[dict[str, Any]],
    steps: list[dict[str, Any]] | None,
    facts: dict[str, Any] | None,
    case_quality: dict[str, Any] | None = None,
    analysis_blocks: dict[str, Any] | None = None,
    bounces: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Run every detector whose preconditions hold; never raise.

    `analysis_blocks` is the classic analysis dict (time_study /
    automation_candidates / segments) when the session has steps, else
    None/empty -- the Tier-1 detectors do not need it.
    """
    facts = facts or {}
    findings: list[dict[str, Any]] = []
    detectors = [
        lambda: _detect_screen_time_sink(events, facts),
        lambda: _detect_fragmentation(facts),
        lambda: _detect_waiting(facts, analysis_blocks),
        lambda: _detect_repetition(analysis_blocks),
        lambda: _detect_backtracking(steps or [], bounces or []),
        lambda: _detect_rekey_transfer(events),
        lambda: _detect_coverage_caveat(events),
    ]
    for det in detectors:
        try:
            findings.extend(det() or [])
        except Exception:  # noqa: BLE001 -- a detector never blocks the rest
            continue
    # variant_divergence (spec table) is viewer-side (lab-phase §D1):
    # it needs >= 2 loaded sessions, so it runs in the Compare surface's
    # aggregate payload (viewer/variant-divergence.js), not here.
    return findings
