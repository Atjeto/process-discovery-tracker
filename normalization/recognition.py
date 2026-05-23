"""Platform/framework interaction recognition (ADR-0011) -- Python side.

A faithful port of viewer/recognition.js, driven by the SAME signature table
(shared/recognition-patterns.json) so the viewer and the normalization pipeline
classify interactions identically. See recognition.js / ADR-0011 for the
principle and the grounding citations.

`recognize()` returns a semantic TYPE (category + framework + typeLabel), not
business meaning -- "form field", "data-grid cell", "primary button" are
knowable from the platform; "serial number" stays an analyst label on top.

The JSON ships to resources/shared/ as an extraResource; in dev it is
../shared/. `Path(__file__).parent.parent / "shared"` resolves to both because
the bundle keeps normalization/ and shared/ as siblings under resources/.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PATTERNS_PATH = (
    Path(__file__).resolve().parent.parent / "shared" / "recognition-patterns.json"
)


def _load_patterns() -> dict[str, Any]:
    with open(_PATTERNS_PATH, encoding="utf-8") as fh:
        return json.load(fh)


_PATTERNS = _load_patterns()
_FRAMEWORK_SIGNATURES: list[dict[str, Any]] = _PATTERNS["frameworkSignatures"]
_UIA_BASE: dict[str, dict[str, str]] = _PATTERNS["uiaBase"]


def recognize(data: dict[str, Any] | None) -> dict[str, Any]:
    """Recognise one interaction's `data`. Mirrors recognition.js exactly:
    framework signatures (most-specific first, first match wins) over the UIA
    ControlType base. `cls` entries are substring-matched against class_name
    unless `exactCls`; `ctIn` optionally constrains control_type."""
    data = data or {}
    cls = data.get("class_name") or ""
    ct = data.get("control_type") or ""

    for sig in _FRAMEWORK_SIGNATURES:
        ct_in = sig.get("ctIn")
        if ct_in and ct not in ct_in:
            continue
        exact = sig.get("exactCls")
        hit = any(
            (cls == c) if exact else (c and c in cls)
            for c in (sig.get("cls") or [])
        )
        if not hit:
            continue
        rich = sig.get("richTextIf")
        if rich and rich in cls:
            return {"category": "rich_text", "framework": sig["framework"],
                    "isChrome": False, "typeLabel": "rich-text field"}
        return {"category": sig["category"], "framework": sig["framework"],
                "isChrome": bool(sig.get("isChrome")), "typeLabel": sig["typeLabel"]}

    base = _UIA_BASE.get(ct)
    if base:
        return {"category": base["category"], "framework": "generic",
                "isChrome": False, "typeLabel": base["typeLabel"]}
    return {"category": "unknown", "framework": "generic", "isChrome": False,
            "typeLabel": ct.lower() if ct else "control"}


def is_browser_chrome(data: dict[str, Any] | None) -> bool:
    """True for the browser's own UI (address bar, tabs, toolbar) -- navigation
    noise rather than a process step."""
    return recognize(data)["isChrome"]
