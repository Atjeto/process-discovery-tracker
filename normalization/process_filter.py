"""Drop PDT's own interactions (+ analyst-excluded apps) from the analysis.

PDT's recorder captures the whole desktop, including the worker's clicks on
PDT's OWN windows -- the live-session operator panel, the marker label picker,
the consent / welcome / settings dialogs. Those are not the business process:
left in, they mine as phantom "PDT Live Session: Fire / Enter label" steps,
attach to no real case (so they pool into the __nocase__ bucket and help explode
the map), and inflate the stats. All of PDT's Electron windows run under the
capture app's single exe, so excluding that process name removes them cleanly.

We drop them from the DERIVED event stream only -- the raw events.jsonl is
immutable (the same discipline as pii_masking), so re-analyzing an EXISTING
session cleans it without rewriting capture data.

Exclusions are the union of:
  * a built-in default: PDT's own process names (the capture app + viewer);
  * a built-in window-title pattern for the tool's own install folder
    (`capture-vX.Y.Z` / `viewer-vX.Y.Z` -- the worker browsing the capture
    install in Explorer shows up as explorer.exe, so only the title betrays
    it; G-4);
  * the capture-side `manifest.config.exclude_processes` knob;
  * the capture app's self-recorded `manifest.tool.process_name` (future-proof,
    exact -- works in dev where the exe is electron.exe);
  * the analyst's per-session `annotations.step_filters.ignored_processes` /
    `ignored_window_titles`.

Process names match case-insensitively with/without a trailing ".exe"; window
titles match as a case-insensitive substring. Applies to interaction AND
activity events (an interaction's process/window is data.process_name /
data.window_title; an activity's is data.app / data.title). system and marker
events are session lifecycle and always pass through.

stdlib-only so it runs under the bundled embeddable and a bare test Python.
"""

from __future__ import annotations

import re
from typing import Any

# PDT's own apps. Stored WITHOUT the .exe suffix; the comparison strips it from
# both sides, so a config entry with or without ".exe" matches either way.
_DEFAULT_PROCESS_NAMES = {
    "process discovery tracker",   # the capture app (all its Electron windows)
    "process discovery viewer",    # the viewer (never the work app; defensive)
}

# G-4: a worker browsing the TOOL'S OWN install/session folder in Windows
# Explorer is tool housekeeping, not the business process -- but Explorer's
# process is explorer.exe, so the process-name exclusion never fires; only the
# window TITLE betrays it (Explorer titles the window with the folder name).
# The release zips unpack to `capture-vX.Y.Z/` / `viewer-vX.Y.Z/` (DEPLOY.md),
# so a title carrying that folder-name shape is PDT's own surface. Matched on
# the title of ANY process (a stray browser tab on the release page is equally
# not the business process).
_SELF_WINDOW_RE = re.compile(r"\b(?:capture|viewer)-v\d+(?:\.\d+)*\b", re.IGNORECASE)


def _norm_proc(s: Any) -> str:
    s = str(s or "").strip().lower()
    return s[:-4] if s.endswith(".exe") else s


def _norm(s: Any) -> str:
    return str(s or "").strip().lower()


def collect_exclusions(manifest: dict | None, annotations: dict | None) -> tuple[set[str], list[str]]:
    """Union the default PDT self-exclusion with the config + analyst lists.
    Returns ``(process_names, window_substrings)`` -- both lower-cased; process
    names are .exe-stripped."""
    procs = set(_DEFAULT_PROCESS_NAMES)
    windows: list[str] = []
    cfg = (manifest or {}).get("config") or {}
    if isinstance(cfg, dict):
        for p in (cfg.get("exclude_processes") or []):
            if isinstance(p, str) and p.strip():
                procs.add(_norm_proc(p))
    tool = (manifest or {}).get("tool")
    if isinstance(tool, dict) and tool.get("process_name"):
        procs.add(_norm_proc(tool["process_name"]))
    sf = (annotations or {}).get("step_filters")
    if isinstance(sf, dict):
        for p in (sf.get("ignored_processes") or []):
            if isinstance(p, str) and p.strip():
                procs.add(_norm_proc(p))
        for w in (sf.get("ignored_window_titles") or []):
            if isinstance(w, str) and w.strip():
                windows.append(_norm(w))
    return procs, windows


def _proc_and_window(ev: dict) -> tuple[str, str]:
    """The (process, window) an event happened in, by type. interaction ->
    process_name/window_title; activity -> app/title; else ('','')."""
    data = ev.get("data") or {}
    t = ev.get("type")
    if t == "interaction":
        return _norm_proc(data.get("process_name")), _norm(data.get("window_title"))
    if t == "activity":
        return _norm_proc(data.get("app")), _norm(data.get("title"))
    return "", ""


def filter_excluded(
    events: list[dict[str, Any]] | None,
    manifest: dict | None = None,
    annotations: dict | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return ``(kept_events, report)``. Drops interaction/activity events whose
    process matches an excluded process name (exact, .exe-insensitive) or whose
    window title contains an excluded substring. The input list is NOT mutated.
    report: ``{ excluded_count, by_process, process_names, window_substrings }``."""
    procs, windows = collect_exclusions(manifest, annotations)
    report: dict[str, Any] = {
        "excluded_count": 0,
        "by_process": {},
        "process_names": sorted(procs),
        "window_substrings": list(windows),
        # G-4 (additive): the built-in title pattern that drops windows
        # browsing the tool's own install folder (Explorer et al.).
        "self_window_pattern": _SELF_WINDOW_RE.pattern,
    }
    if not isinstance(events, list):
        return ([] if events is None else events), report

    out: list[dict[str, Any]] = []
    by_proc: dict[str, int] = {}
    for ev in events:
        if isinstance(ev, dict) and ev.get("type") in ("interaction", "activity"):
            pn, wt = _proc_and_window(ev)
            if ((pn and pn in procs)
                    or (wt and any(w in wt for w in windows))
                    or (wt and _SELF_WINDOW_RE.search(wt))):
                by_proc[pn or "(unknown)"] = by_proc.get(pn or "(unknown)", 0) + 1
                continue
        out.append(ev)
    report["excluded_count"] = sum(by_proc.values())
    report["by_process"] = by_proc
    return out, report
