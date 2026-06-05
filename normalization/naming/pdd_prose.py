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

    Pulls additional structural cues when present so the LLM has enough
    literal evidence to stay grounded instead of inventing context. With
    only label + apps as cues a small model invariably hallucinates
    plausible-sounding business prose; the extra fields below give it the
    raw label vocabulary it can paraphrase rather than embellish.
    """
    cues: dict[str, Any] = {
        "label": process.get("label", ""),
        "apps": list(process.get("apps") or []),
    }
    # Observed activity labels — the literal step names mined from the
    # cluster. These are the LLM's strongest grounding signal because they
    # already carry the domain vocabulary (e.g. "Incident: Save record").
    raw_act = process.get("activity_labels") or process.get("step_labels")
    if raw_act:
        seen = []
        for x in raw_act:
            if not x or x in seen:
                continue
            seen.append(str(x))
            if len(seen) >= 8:
                break
        if seen:
            cues["activity_labels"] = seen
    # Window-title-derived screen labels — same logic, narrower in scope.
    raw_scr = process.get("screen_labels") or process.get("screens")
    if raw_scr:
        seen2 = []
        for x in raw_scr:
            if not x or x in seen2:
                continue
            seen2.append(str(x))
            if len(seen2) >= 8:
                break
        if seen2:
            cues["screen_labels"] = seen2
    # Recognised interaction types (Click, Save, Submit...) — the recorder's
    # classification of what the worker did, no domain leakage.
    raw_it = process.get("interaction_types")
    if raw_it:
        cues["interaction_types"] = list(raw_it)[:12]
    return cues


# Words the small qwen-1.5b model gravitates to when forced to write
# generic prose on thin input. If any appear in the generated text we
# treat the response as hallucinated and fall back to the template.
_HALLUCINATION_MARKERS = (
    "executive", "stakeholder", "stakeholders", "crucial", "essential",
    "professional", "productivity", "strategic", "integrity",
    "maintain", "ensures", "ensuring", "ensure",
    "beneficiar", "motivation",
)


def _looks_hallucinated(text: str) -> bool:
    if not text:
        return True
    lower = text.lower()
    return any(m in lower for m in _HALLUCINATION_MARKERS)


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
            response.text.lower().startswith(INSUFFICIENT_SIGNAL.lower()) or \
            _looks_hallucinated(response.text):
        # Fallback: deterministic templated paragraph (no LLM). The template
        # quotes the literal cues we have — observed activity labels and
        # screen contexts — so the §1 paragraph carries real evidence even
        # when the LLM refuses, not generic filler.
        cues = _process_to_derived_input(process)
        act_labels = cues.get("activity_labels") or []
        scr_labels = cues.get("screen_labels") or []
        if act_labels:
            shown_acts = ", ".join(repr(a) for a in act_labels[:3])
            obs_clause = (
                f" Across these sessions the recorder observed the "
                f"following step labels for this process: {shown_acts}."
            )
        else:
            obs_clause = ""
        if scr_labels and not act_labels:
            obs_clause = (
                f" Observed window contexts: {', '.join(scr_labels[:3])}."
            )
        templated = (
            f"This process was identified across multiple captured sessions "
            f"as a recurring pattern of work in {apps}. It is referenced "
            f"throughout the engagement as {label!r}.{obs_clause} The "
            f"remainder of this document summarises what was observed, where "
            f"the time goes, and the recommended next steps for automation "
            f"candidacy review."
        )
        return {
            "prose": templated,
            "confidence": 0.0,
            "provenance": [],
            "insufficient_signal": True,
            "source": "template_fallback",
        }
    # Belt-and-braces: drop any trailing INSUFFICIENT_SIGNAL marker the
    # small model occasionally appends *after* a paragraph.
    cleaned_text = response.text
    if INSUFFICIENT_SIGNAL.lower() in cleaned_text.lower():
        idx = cleaned_text.lower().index(INSUFFICIENT_SIGNAL.lower())
        cleaned_text = cleaned_text[:idx].strip().rstrip(".") + "."
    return {
        "prose": cleaned_text,
        "confidence": response.confidence,
        "provenance": list(response.provenance),
        "insufficient_signal": False,
        "source": "llm",
    }
