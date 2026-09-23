"""Tier-1 measured facts for analysis.json (lab-phase spec §A2).

Everything in this block is a direct measurement over the derived event
stream -- no heuristic judgments, no case boundaries required. It always
renders (the honesty architecture's Tier 1) and feeds the viewer's
Overview fact strip plus the memo's fact strip.

  active_ms        -- summed foreground-window time (activity duration_ms)
                      minus the measured idle intervals inside those runs,
                      so active_ms and idle_ms never count the same time.
  idle_ms          -- summed idle_start/idle_end intervals the recorder
                      measured (0 when the session has no idle events).
  top_apps         -- top 5 apps by foreground time, each with its share.
  app_switches     -- count of foreground-app changes (+ per-hour rate).
  longest_focus_ms -- the longest unbroken same-app foreground stretch.
  rekey_count      -- distinct values typed into 2+ different apps
                      (value-equality on the derived stream; PII-masked
                      values compare by their join-preserving token).
  repeated_sequence_count -- motif count from motifs.find_motifs (§A3).
  app_time_source  -- where the app-time numbers came from (G-2, additive):
                      "activity" (measured foreground durations),
                      "interactions" (estimated from interaction
                      process_name + timestamps when activity events are
                      absent or carry no durations -- old captures, e.g.
                      v0.9.0), or "none" (no usable signal at all; the
                      app-time numbers above are then NOT facts and every
                      consumer must render "not available from this
                      recording" instead of a confident zero).

Pure stdlib.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Any

from _dt import parse_ts_or_none as _parse_ts

# Shortest typed value considered for re-key matching -- below this,
# equal values are noise (single digits, "OK", blanks). Mirrors
# analysis_common.TRANSFER_MIN_LEN.
REKEY_MIN_LEN = 4

# Lab-phase C1: a field whose vocab entry declares `carries_value: true` is a
# KNOWN business-value carrier, so its typed values join the rekey field set
# at a relaxed minimum (a 3-char cost-center code re-keyed across apps is
# signal when the vocab vouches for the field; still never single chars).
REKEY_MIN_LEN_VOCAB = 2

TOP_APPS_N = 5

# A per-hour rate is stated only for a recording at least this long (DA gap
# 9): below it, "16 switches (168.4/h)" extrapolates a rate from a few
# minutes, so renderers state the plain count instead.
PER_HOUR_MIN_SPAN_MS = 30 * 60 * 1000

# G-2 interaction-derived fallback: the dwell attributed to an interaction is
# the gap to the NEXT interaction, capped -- a long think/lunch gap must not
# credit one app with an hour of "focus" the recorder never measured.
INTERACTION_GAP_CAP_MS = 60_000

# Literal junk an old recorder emits as a typed "value" -- never a business
# value, so it must not feed re-key matching (G-4: the owner's v0.9.0 session
# emitted the string "null").
_NOISE_VALUES = frozenset({"null", "(null)", "undefined", "(undefined)"})


def _activity_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        e for e in (events or [])
        if isinstance(e, dict) and e.get("type") == "activity"
        and isinstance(e.get("data"), dict)
    ]


def _duration_ms(data: dict) -> float:
    v = data.get("duration_ms")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0.0
    return float(v) if v > 0 else 0.0


def _session_span_ms(events: list[dict[str, Any]]) -> float:
    """First-to-last event timestamp, in ms. 0 when unparseable."""
    first = last = None
    for ev in events or []:
        t = _parse_ts(ev.get("timestamp")) if isinstance(ev, dict) else None
        if t is None:
            continue
        if first is None or t < first:
            first = t
        if last is None or t > last:
            last = t
    if first is None or last is None or last <= first:
        return 0.0
    return (last - first).total_seconds() * 1000.0


def _idle_intervals(events: list[dict[str, Any]]) -> list[tuple[Any, Any]]:
    """The measured idle intervals: paired idle_start/idle_end system events,
    as (start, end) datetimes. The single source for both idle_ms and the
    idle time subtracted from active time, so the two never double-count."""
    intervals = []
    open_start = None
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "system":
            continue
        kind = (ev.get("data") or {}).get("kind")
        if kind == "idle_start":
            open_start = _parse_ts(ev.get("timestamp"))
        elif kind == "idle_end":
            end = _parse_ts(ev.get("timestamp"))
            if open_start is not None and end is not None and end > open_start:
                intervals.append((open_start, end))
            open_start = None
    return intervals


def _idle_ms(events: list[dict[str, Any]]) -> int:
    """Total measured idle time: paired idle_start/idle_end system events."""
    return round(sum((end - start).total_seconds() * 1000.0
                     for start, end in _idle_intervals(events)))


def _active_duration_ms(ev: dict, idle: list[tuple[Any, Any]],
                        window: tuple[Any, Any] | None = None) -> float:
    """An activity run's foreground time minus the recorded idle time inside
    it (RP-07). The recorder keeps a foreground run open through an idle
    stretch, so its duration_ms includes that idle time; subtracting it keeps
    active time and idle time disjoint. A run whose timestamp cannot be read
    cannot be placed against the idle intervals and keeps its full duration.

    `window` (start, end), either side None for open, limits the run to one
    recorded run's span first (stats' per-run active time), so a run's active
    time never exceeds its elapsed time."""
    dur = _duration_ms(ev["data"])
    start = _parse_ts(ev.get("timestamp"))
    if start is None or dur <= 0:
        return dur
    end = start + timedelta(milliseconds=dur)
    if window is not None:
        w0, w1 = window
        start = max(start, w0) if w0 is not None else start
        end = min(end, w1) if w1 is not None else end
        if end <= start:
            return 0.0
        dur = (end - start).total_seconds() * 1000.0
    overlap = 0.0
    for i0, i1 in idle:
        lo, hi = max(start, i0), min(end, i1)
        if hi > lo:
            overlap += (hi - lo).total_seconds() * 1000.0
    return max(0.0, dur - overlap)


def _typed_value(ev: dict) -> str:
    """The non-empty stripped value typed in this interaction, or ""."""
    d = ev.get("data")
    if not isinstance(d, dict):
        return ""
    if d.get("kind") not in ("value_changed", "text_changed"):
        return ""
    val = d.get("value")
    if not isinstance(val, str):
        return ""
    val = val.strip()
    if val.lower() in _NOISE_VALUES:
        return ""
    return val


def _field_label(data: dict) -> str:
    """A short display handle for the field a value was typed into --
    the vocab meaningful_name when enriched, else the raw control identity."""
    for k in ("meaningful_name", "automation_id", "name"):
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def rekey_details(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Values typed (value_changed/text_changed) into 2+ distinct apps.

    Compares the DERIVED stream's values literally, so a PII-masked value
    matches by its join-preserving token -- the masking deliberately keeps
    equality intact. Returns one row per re-keyed value with the apps, the
    fields involved, and the typing event_ids, sorted by app-spread then
    value for stability.

    The field set (lab-phase C1): values must clear REKEY_MIN_LEN, except
    when typed into a field whose vocab entry declares `carries_value: true`
    (data.vocab_semantics, stamped by app_vocab enrichment) -- those join
    at REKEY_MIN_LEN_VOCAB, because the vocabulary vouches that the field
    holds a business value rather than noise.
    """
    by_value: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    fields_by_value: dict[str, set[str]] = defaultdict(set)
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        val = _typed_value(ev)
        if not val:
            continue
        data = ev.get("data") or {}
        vouched = (data.get("vocab_semantics") or {}).get("carries_value") is True
        if len(val) < (REKEY_MIN_LEN_VOCAB if vouched else REKEY_MIN_LEN):
            continue
        app = (data.get("process_name") or "").strip().lower()
        if not app:
            continue
        by_value[val][app].append(ev.get("event_id") or "")
        label = _field_label(data)
        if label:
            fields_by_value[val].add(label)

    out: list[dict[str, Any]] = []
    for val, apps in by_value.items():
        if len(apps) < 2:
            continue
        event_ids = [eid for ids in apps.values() for eid in ids if eid]
        out.append({
            "value": val,
            "apps": sorted(apps.keys()),
            "app_count": len(apps),
            "fields": sorted(fields_by_value.get(val) or []),
            "event_ids": event_ids,
            "entry_count": sum(len(ids) for ids in apps.values()),
        })
    out.sort(key=lambda r: (-r["app_count"], -r["entry_count"], r["value"]))
    return out


def _derive_app_time_from_interactions(
    events: list[dict[str, Any]],
) -> tuple[dict[str, float], int, float] | None:
    """G-2 fallback: estimate (per_app, switches, longest_focus) from
    interaction events' process_name + timestamps when the session has no
    usable activity signal (old captures, e.g. v0.9.0, emit no activity
    events / no duration_ms). The dwell credited to an interaction is the
    gap to the next one, capped at INTERACTION_GAP_CAP_MS so unmeasured
    pauses don't inflate one app. Returns None when interactions carry no
    usable app/timestamp signal -- the caller then reports "none" and the
    consumers say "not available from this recording" instead of 0."""
    rows: list[tuple[Any, str]] = []
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        data = ev.get("data")
        if not isinstance(data, dict):
            continue
        app = (data.get("process_name") or "").strip()
        if app.lower().endswith(".exe"):
            app = app[:-4]
        t = _parse_ts(ev.get("timestamp"))
        if not app or t is None:
            continue
        rows.append((t, app))
    if len(rows) < 2:
        return None
    rows.sort(key=lambda r: r[0])
    per_app: dict[str, float] = defaultdict(float)
    switches = 0
    longest = 0.0
    run = 0.0
    prev_app = None
    for i, (t, app) in enumerate(rows):
        if i + 1 < len(rows):
            gap = (rows[i + 1][0] - t).total_seconds() * 1000.0
            dwell = min(max(gap, 0.0), INTERACTION_GAP_CAP_MS)
        else:
            dwell = 0.0
        per_app[app] += dwell
        if prev_app is not None and app != prev_app:
            switches += 1
            run = dwell
        else:
            run += dwell
        if run > longest:
            longest = run
        prev_app = app
    if sum(per_app.values()) <= 0:
        return None
    return per_app, switches, longest


def compute_facts(
    events: list[dict[str, Any]],
    motifs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the `analysis.facts` block. `motifs` is the find_motifs output
    (only its length is read -- the repeated-sequence count)."""
    acts = _activity_events(events)
    idle = _idle_intervals(events)

    per_app: dict[str, float] = defaultdict(float)
    switches = 0
    longest = 0.0
    run = 0.0
    prev_app = None
    for ev in acts:
        data = ev["data"]
        app = (data.get("app") or "").strip() or "(unknown)"
        dur = _active_duration_ms(ev, idle)
        per_app[app] += dur
        if prev_app is not None and app != prev_app:
            switches += 1
            run = dur
        else:
            run += dur
        if run > longest:
            longest = run
        prev_app = app

    active_ms = round(sum(per_app.values()))

    # G-2: an old capture shape (v0.9.0) has no activity events / durations,
    # which used to render every app-time fact as a confident 0. Fall back to
    # an interaction-derived estimate; failing that, say so via the source key.
    # The test is the RAW durations: runs that were all idle are a measured
    # zero of active time, not a missing signal.
    app_time_source = "activity"
    if not any(_duration_ms(ev["data"]) > 0 for ev in acts):
        derived = _derive_app_time_from_interactions(events)
        if derived is not None:
            per_app, switches, longest = derived
            per_app = defaultdict(float, per_app)
            active_ms = round(sum(per_app.values()))
            app_time_source = "interactions"
        else:
            app_time_source = "none"
    top_apps = [
        {"app": app, "ms": round(ms),
         "share": round(ms / active_ms, 3) if active_ms else 0.0}
        for app, ms in sorted(per_app.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_APPS_N]
    ]

    span_ms = _session_span_ms(events)
    span_hours = span_ms / 3600000.0
    switches_per_hour = round(switches / span_hours, 1) if span_hours > 0 else 0.0

    return {
        "active_ms": active_ms,
        "idle_ms": _idle_ms(events),
        "session_span_ms": round(span_ms),
        "top_apps": top_apps,
        "app_switches": switches,
        "switches_per_hour": switches_per_hour,
        "longest_focus_ms": round(longest),
        "rekey_count": len(rekey_details(events)),
        "repeated_sequence_count": len(motifs or []),
        "app_time_source": app_time_source,
    }
