"""Activity naming — PDT-1.0-SPEC §3.2 (first of the two LLM uses).

Turns Pattern-Layer activity clusters into business-language names.
The Cockpit reads the result; if the LLM refuses or the input is too
thin, the cluster's existing process_label survives (graceful degrade).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .confidence import enough_signal, INSUFFICIENT_SIGNAL
from .llm_client import LlmBackend, LlmRequest, get_default_backend


@dataclass
class ActivityName:
    """An LLM-named activity. `name` is INSUFFICIENT_SIGNAL when the
    layer refused; downstream consumers display the cluster's
    process_label in that case."""
    cluster_id: str
    name: str
    confidence: float = 0.0
    provenance: list[str] = field(default_factory=list)
    insufficient_signal: bool = False
    fallback_label: str = ""

    def display_name(self) -> str:
        """The name a consumer should actually render — falls back to
        the heuristic process_label when the LLM refused."""
        if self.insufficient_signal or self.name == INSUFFICIENT_SIGNAL:
            return self.fallback_label or "(unnamed cluster)"
        return self.name

    def to_dict(self) -> dict[str, Any]:
        return {
            "cluster_id": self.cluster_id,
            "name": self.name,
            "confidence": round(self.confidence, 3),
            "provenance": list(self.provenance),
            "insufficient_signal": self.insufficient_signal,
            "fallback_label": self.fallback_label,
        }


def _cluster_to_derived_input(cluster: dict[str, Any]) -> dict[str, Any]:
    """Project the cluster onto the bounded derived-input shape the LLM sees.
    Hard rule: this MUST NOT include raw event content (no keystrokes,
    no clipboard, no values). Only structural facts."""
    return {
        "process_label": cluster.get("process_label", ""),
        "screen_label": cluster.get("screen_label", ""),
        "app": cluster.get("app", ""),
        "interaction_types": list(cluster.get("interaction_types") or []),
        "vocab_names": list(cluster.get("vocab_names") or []),
        "confidence": cluster.get("confidence", 0.0),
    }


def name_activity_clusters(
    clusters: list[dict[str, Any]],
    *,
    backend: LlmBackend | None = None,
    disagreements: list[dict[str, Any]] | None = None,
) -> list[ActivityName]:
    """Name every cluster above the capture-confidence floor.

    Returns a list of `ActivityName` in the same order as the input
    clusters. Below-floor clusters are returned with
    `insufficient_signal=True` and the fallback to the cluster's
    process_label.

    PDT-1.0-SPEC §4.3 disagreement consumption: when `disagreements` is
    provided, any cluster whose members include a step the user previously
    edited away from is forbidden from re-emitting the rejected name (the
    LLM may still propose a *different* name, but the previously-rejected
    string never returns). And for any cluster with a `proposed` name the
    user supplied, that proposed name is adopted verbatim — no LLM call —
    so saved corrections persist across re-normalize.
    """
    backend = backend or get_default_backend()

    # Index disagreements: rejected name set per step_id, plus per-step user-
    # proposed name (if any).
    rejected_by_step: dict[str, set[str]] = {}
    proposed_by_step: dict[str, str] = {}
    for d in (disagreements or []):
        if not isinstance(d, dict):
            continue
        sid = d.get("step_id")
        rej = (d.get("rejected") or "").strip()
        prop = (d.get("proposed") or "").strip()
        if sid and rej:
            rejected_by_step.setdefault(sid, set()).add(rej.lower())
        if sid and prop:
            # Last-write-wins: a later edit overrides an earlier one.
            proposed_by_step[sid] = prop

    out: list[ActivityName] = []
    for c in clusters or []:
        if not isinstance(c, dict):
            continue
        cluster_id = c.get("cluster_id", "")
        fallback = c.get("process_label") or c.get("screen_label") or ""
        step_ids = c.get("step_ids") or []

        # If ANY member step has a user-proposed name and the LLM hasn't been
        # given a contradicting signal, adopt it verbatim. Majority wins
        # when multiple steps in the same cluster were edited to different
        # names; ties resolve to the heuristic fallback.
        proposed_in_cluster: dict[str, int] = {}
        for sid in step_ids:
            p = proposed_by_step.get(sid)
            if p:
                proposed_in_cluster[p] = proposed_in_cluster.get(p, 0) + 1
        if proposed_in_cluster:
            top = sorted(proposed_in_cluster.items(),
                         key=lambda kv: (-kv[1], kv[0]))
            if len(top) == 1 or top[0][1] > top[1][1]:
                out.append(ActivityName(
                    cluster_id=cluster_id,
                    name=top[0][0],
                    confidence=1.0,                # the user said so
                    provenance=["user_correction"],
                    insufficient_signal=False,
                    fallback_label=fallback,
                ))
                continue

        if not enough_signal(cluster=c):
            out.append(ActivityName(
                cluster_id=cluster_id,
                name=INSUFFICIENT_SIGNAL,
                insufficient_signal=True,
                fallback_label=fallback,
            ))
            continue

        # Build the set of names the LLM is forbidden from returning.
        forbidden: set[str] = set()
        for sid in step_ids:
            for rej in rejected_by_step.get(sid, set()):
                forbidden.add(rej)

        request = LlmRequest(
            purpose="activity_name",
            derived_input=_cluster_to_derived_input(c),
        )
        response = backend.complete(request)
        # If the LLM proposed a previously-rejected name, drop to fallback
        # rather than re-suggest the bad name.
        if (response.text or "").strip().lower() in forbidden:
            out.append(ActivityName(
                cluster_id=cluster_id,
                name=INSUFFICIENT_SIGNAL,
                confidence=0.0,
                provenance=["llm_re_proposed_rejected_name"],
                insufficient_signal=True,
                fallback_label=fallback,
            ))
            continue

        out.append(ActivityName(
            cluster_id=cluster_id,
            name=response.text,
            confidence=response.confidence,
            provenance=list(response.provenance),
            insufficient_signal=response.insufficient_signal,
            fallback_label=fallback,
        ))
    return out
