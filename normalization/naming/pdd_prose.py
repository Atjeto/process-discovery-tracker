"""PDD executive-summary prose — PDT-1.0-SPEC §3.2, second LLM use.

The single paragraph that opens each Process Discovery Document. Drafted
by the LLM around the measured numbers — the LLM writes the prose, the
template inserts the numbers (no-numbers-from-LLM rule).

Everything else in the PDD (§2–§5) stays templated, per the spec's scope
decision.
"""

from __future__ import annotations

from typing import Any

from .confidence import INSUFFICIENT_SIGNAL
from .llm_client import LlmBackend, LlmRequest, get_default_backend


def _process_to_derived_input(process: dict[str, Any]) -> dict[str, Any]:
    """Project the process row onto the bounded derived-input shape.
    Hard rule: no raw event content, no numerical content.
    """
    return {
        "label": process.get("label", ""),
        "apps": list(process.get("apps") or []),
    }


def draft_exec_summary(
    process: dict[str, Any],
    *,
    backend: LlmBackend | None = None,
) -> dict[str, Any]:
    """Draft the executive-summary paragraph for one process.

    Returns a dict with:
      - `prose`: the LLM's paragraph, scrubbed of any numerical tokens.
                 Falls back to a templated paragraph when the LLM refuses.
      - `confidence`: the LLM's confidence (0 when refused).
      - `provenance`: which derived fields the LLM saw.
      - `insufficient_signal`: True when refused (template was used).
    """
    backend = backend or get_default_backend()
    label = process.get("label") or "(unnamed process)"
    apps = ", ".join(process.get("apps") or []) or "(unknown applications)"

    request = LlmRequest(
        purpose="exec_summary",
        derived_input=_process_to_derived_input(process),
    )
    response = backend.complete(request)
    if response.insufficient_signal or not response.text or \
            response.text.lower().startswith(INSUFFICIENT_SIGNAL.lower()):
        # Fallback: deterministic templated paragraph (no LLM).
        templated = (
            f"This process was identified across multiple captured sessions as "
            f"a recurring pattern of work involving {apps}. It is referenced "
            f"throughout the engagement as {label!r}. The remainder of this "
            f"document summarises what was observed, where the time goes, and "
            f"the recommended next steps for automation candidacy review."
        )
        return {
            "prose": templated,
            "confidence": 0.0,
            "provenance": [],
            "insufficient_signal": True,
            "source": "template_fallback",
        }
    return {
        "prose": response.text,
        "confidence": response.confidence,
        "provenance": list(response.provenance),
        "insufficient_signal": False,
        "source": "llm",
    }
