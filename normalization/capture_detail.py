"""The apps the recorder saw with less detail (analysis.json `coverage_caveat`).

The one check of the recording the viewer still shows: the Overview's
project line warns when the recorder could identify less of what was clicked
or typed in some application (a remote or terminal window, an app that does
not name its fields, weak field identification), because the steps drafted
there rest on less detail. It is kept from the analysis layer the light
version cut (the findings feed, the facts and the step analysis: nothing
read them).

    {"claim": "The recorder saw less detail in 1 of 3 apps: Citrix (a
               remote/terminal window: only the screen image crosses it).",
     "flagged_apps": [{"app", "trust", "why", "mean_confidence"}, ...],
     "total_apps": 3}

or None when every app was recorded in full detail (or nothing was
recorded). The claim names the apps by their readable names
(app_names.display_name), never by their executable token.

Pure stdlib.
"""
from __future__ import annotations

from typing import Any

from app_names import display_name

# coverage_hint values that mark reduced capture fidelity (§11e). A
# remote/terminal framework is the capture "wall": the field data is a proxy
# for pixels.
_REDUCED_HINTS = {"basic", "minimal"}
_WALL_FRAMEWORKS = {"remote", "terminal", "rdp", "citrix"}
_LOW_CONFIDENCE_MEAN = 0.5
# The claim names at most this many apps.
_NAMED_APPS = 4


def coverage_caveat(events: list[dict[str, Any]] | None,
                    app_names: dict[str, str] | None = None) -> dict[str, Any] | None:
    """The apps whose interactions the recorder saw with less detail, as the
    block above, or None when none was. An app is flagged when an interaction
    in it came through a remote or terminal framework, carried a reduced
    coverage hint, or its interactions' mean confidence is below one half."""
    per_app: dict[str, dict[str, Any]] = {}
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        app = (data.get("process_name") or "").strip() if isinstance(data.get("process_name"), str) else ""
        if not app:
            continue
        rec = per_app.setdefault(app, {"hints": set(), "frameworks": set(), "confidences": []})
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
            trust = "wall"
            why = "a remote/terminal window: only the screen image crosses it"
        elif reduced_hint:
            trust = sorted(rec["hints"] & _REDUCED_HINTS)[0]
            why = ("the app does not name its fields reliably" if trust == "basic"
                   else "only the window title was readable")
        else:
            trust = "low-confidence"
            why = f"field identification was weak (score {round(mean_conf, 2)} of 1)"
        flagged.append({
            "app": app,
            "trust": trust,
            "why": why,
            "mean_confidence": round(mean_conf, 2) if mean_conf is not None else None,
        })
    if not flagged:
        return None
    # The machine tier name ("wall", "basic", "minimal") stays in the block
    # for tooling; the claim says only the plain-words reason.
    listing = "; ".join(f"{display_name(f['app'], app_names)} ({f['why']})"
                        for f in flagged[:_NAMED_APPS])
    return {
        "claim": (f"The recorder saw less detail in {len(flagged)} of "
                  f"{len(per_app)} apps: {listing}."),
        "flagged_apps": flagged,
        "total_apps": len(per_app),
    }
