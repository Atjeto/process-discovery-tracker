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

# A remote/terminal framework is the capture "wall": the field data is a
# proxy for pixels.
_WALL_FRAMEWORKS = {"remote", "terminal", "rdp", "citrix"}
_LOW_CONFIDENCE_MEAN = 0.5
# The share of an app's interactions that must name their control by an
# automation id (else by a name) for the app to count as seen in full.
_IDENTIFIED_SHARE = 0.5
# The claim names at most this many apps.
_NAMED_APPS = 4


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def coverage_caveat(events: list[dict[str, Any]] | None,
                    app_names: dict[str, str] | None = None) -> dict[str, Any] | None:
    """The apps whose interactions the recorder saw with less detail, as the
    block above, or None when none was. An app is flagged when an interaction
    in it came through a remote or terminal framework, when fewer than half
    of its interactions that say how their control was identified
    (identity_source) had an automation id ("basic": most had a name,
    else "minimal"), or when its interactions' mean confidence is below one
    half. Lane LF-PIPE: the share of the app's interactions, not the
    recorder's coverage hint, which only its first interaction carries
    (Paint was flagged for its first click, though most of its clicks had
    an id)."""
    per_app: dict[str, dict[str, Any]] = {}
    for ev in events or []:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
        app = (data.get("process_name") or "").strip() if isinstance(data.get("process_name"), str) else ""
        if not app:
            continue
        rec = per_app.setdefault(app, {"count": 0, "ids": 0, "named": 0,
                                       "frameworks": set(), "confidences": []})
        # Only an interaction that says how its control was identified
        # (identity_source, §11e) counts in the share.
        rung = _text(data.get("identity_source"))
        if rung:
            rec["count"] += 1
            if rung == "automation_id":
                rec["ids"] += 1
            if rung in ("automation_id", "name"):
                rec["named"] += 1
        fw = data.get("framework")
        if isinstance(fw, str) and fw:
            rec["frameworks"].add(fw.lower())
        conf = data.get("confidence")
        if isinstance(conf, (int, float)) and not isinstance(conf, bool):
            rec["confidences"].append(float(conf))

    flagged = []
    for app, rec in sorted(per_app.items()):
        wall = bool(rec["frameworks"] & _WALL_FRAMEWORKS)
        reduced = rec["count"] > 0 and rec["ids"] < _IDENTIFIED_SHARE * rec["count"]
        mean_conf = (sum(rec["confidences"]) / len(rec["confidences"])
                     if rec["confidences"] else None)
        low_conf = mean_conf is not None and mean_conf < _LOW_CONFIDENCE_MEAN
        if not (wall or reduced or low_conf):
            continue
        if wall:
            trust = "wall"
            why = "a remote/terminal window: only the screen image crosses it"
        elif reduced:
            trust = "basic" if rec["named"] >= _IDENTIFIED_SHARE * rec["count"] else "minimal"
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
