"""LLM-as-judge cluster-equivalence — PDT-1.0-SPEC §3.1 (semantic merge v2).

The cosine-on-embedding approach (all-minilm) is too conservative on
short labels — "Submit" / "Send" / "Save record" never hit threshold
even though they're the same conceptual activity. This module asks the
already-bundled instruct model (qwen2.5:1.5b) a constrained yes/no
question per cluster pair: "Are these the same activity?" The model
answers in a fixed format we parse for `same: yes|no`.

The judge is bounded:
- Only same-app pairs are compared (different-app collisions don't merge).
- We cap the number of candidate pairs (top-K most frequent clusters)
  so a session with 50 clusters doesn't fire 1225 LLM calls.
- A fast path: pairs whose embedding cosine ≥ 0.78 short-circuit to YES
  without calling the LLM (cheap, accurate when it fires).
- Pairs whose cosine ≤ 0.30 short-circuit to NO (obvious mismatches).
- Pairs in the gray zone (0.30 < cos < 0.78) get the LLM call.

This blend keeps the cost predictable: O(K log K) embedding compares
plus at most O(K) LLM calls for a session with K candidate clusters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .embeddings import cosine_similarity, embed_batch, is_available as embed_available
from .llm_client import LlmBackend, LlmRequest, NullBackend, get_default_backend


# Below this cosine, the labels are obviously not the same activity — skip the LLM.
COSINE_OBVIOUS_NO = 0.30
# Above this cosine, the labels are obviously the same — skip the LLM.
COSINE_OBVIOUS_YES = 0.78
# Hard cap on LLM judge calls per session — protects worst-case latency.
MAX_JUDGE_CALLS = 60
# Cap on candidate clusters considered for merging (top-K by occurrence).
TOP_K_CLUSTERS = 20


@dataclass
class JudgeResult:
    same: bool
    source: str           # "cosine_yes" | "cosine_no" | "llm" | "llm_refused"
    confidence: float     # judge-output confidence in [0, 1]
    raw: str = ""


def _build_judge_prompt(label_a: str, label_b: str, app: str) -> str:
    """Extraction-style prompt. Direct yes/no judgement on a 1.5B model
    is unreliable (too permissive). Instead, ask the model to extract
    (action_verb, action_object) from each label — extraction is an
    easier task — and let the caller compare extracted pairs
    deterministically. SAME iff verbs match AND objects match (after
    light normalisation)."""
    return (
        "Extract the ACTION VERB (what was done) and the ACTION OBJECT "
        "(what it was done to) from each activity label. Use short, "
        "general words — 'submit' not 'Submit form via portal'.\n"
        "\n"
        "Output format (EXACTLY this, lowercase, one per line):\n"
        "  a_verb: <verb>\n"
        "  a_object: <object>\n"
        "  b_verb: <verb>\n"
        "  b_object: <object>\n"
        "\n"
        "Examples:\n"
        "  Label A: Submit form    Label B: Send form\n"
        "  a_verb: submit\n"
        "  a_object: form\n"
        "  b_verb: send\n"
        "  b_object: form\n"
        "\n"
        "  Label A: Save record    Label B: Open record\n"
        "  a_verb: save\n"
        "  a_object: record\n"
        "  b_verb: open\n"
        "  b_object: record\n"
        "\n"
        "  Label A: Enter Status cell    Label B: Enter Date cell\n"
        "  a_verb: enter\n"
        "  a_object: status cell\n"
        "  b_verb: enter\n"
        "  b_object: date cell\n"
        "\n"
        f"Now extract for (application: {app or '(unknown)'}):\n"
        f"  Label A: {label_a}\n"
        f"  Label B: {label_b}\n"
        "\n"
    )


# Verb-synonym groups: extracted verbs that count as the same action.
_VERB_SYNONYMS = [
    {"submit", "send", "post", "publish", "fire"},
    {"save", "store", "persist", "commit", "update"},
    {"open", "view", "load", "show", "display"},
    {"create", "new", "add"},
    {"delete", "remove", "drop"},
    {"search", "find", "lookup", "query", "look up"},
    {"review", "triage", "inspect", "check"},
    {"enter", "type", "fill", "input"},
]


def _verbs_equivalent(a: str, b: str) -> bool:
    a, b = a.strip().lower(), b.strip().lower()
    if not a or not b:
        return False
    if a == b:
        return True
    for group in _VERB_SYNONYMS:
        if a in group and b in group:
            return True
    return False


def _objects_equivalent(a: str, b: str) -> bool:
    """Objects must match closely. Light normalisation: lower + strip
    articles + collapse whitespace. 'the form' == 'form'; 'Status cell'
    != 'Date cell' (different qualifier means different target)."""
    norm = lambda s: " ".join((s or "").strip().lower().replace("the ", "").split())
    return norm(a) == norm(b)


def _parse_extraction(text: str) -> tuple[str, str, str, str] | None:
    """Pull a_verb/a_object/b_verb/b_object from the model output.
    Returns None if any field is missing."""
    if not text:
        return None
    fields = {}
    for raw_line in text.strip().splitlines()[:12]:
        line = raw_line.strip().strip("*-• ")
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip().lower()
        val = val.strip().strip(".\"'`")
        if key in ("a_verb", "a_object", "b_verb", "b_object") and val:
            fields[key] = val
    if all(k in fields for k in ("a_verb", "a_object", "b_verb", "b_object")):
        return (fields["a_verb"], fields["a_object"],
                fields["b_verb"], fields["b_object"])
    return None


def _parse_judge(text: str) -> tuple[bool | None, float]:
    """Parse the model's extracted (verb, object) for each label and
    apply the verb-synonym + object-match rule. Returns
    (same_or_None_if_unparseable, confidence_in_[0,1])."""
    extracted = _parse_extraction(text)
    if extracted is None:
        return None, 0.0
    a_verb, a_obj, b_verb, b_obj = extracted
    verbs_match = _verbs_equivalent(a_verb, b_verb)
    objs_match = _objects_equivalent(a_obj, b_obj)
    same = verbs_match and objs_match
    # Confidence reflects how clean the match was. Both axes match
    # exactly → high; verb synonym + object exact → still high; either
    # axis missing → low.
    conf = 0.85 if (a_verb == b_verb and objs_match) else (0.7 if same else 0.7)
    return same, conf


def judge_pair(
    label_a: str,
    label_b: str,
    app: str,
    *,
    backend: LlmBackend | None = None,
) -> JudgeResult:
    """One pair judgement. Uses the LlmRequest envelope with a new
    purpose so the backend's existing prompt builder doesn't override
    ours."""
    backend = backend or get_default_backend()
    if isinstance(backend, NullBackend):
        return JudgeResult(same=False, source="llm_refused", confidence=0.0,
                            raw="(NullBackend)")

    # Build a raw-purpose request and reach down into the OllamaBackend.
    # We don't want activity_name's "produce a name" prompt — we want our
    # SAME/DIFFERENT prompt. So we build a thin request whose
    # derived_input carries the prompt directly under `_raw_prompt`.
    request = LlmRequest(
        purpose="cluster_equivalence",
        derived_input={
            "label_a": label_a,
            "label_b": label_b,
            "app": app,
            "_raw_prompt": _build_judge_prompt(label_a, label_b, app),
        },
        timeout_seconds=90.0,
    )

    # The OllamaBackend's _build_prompt has a switch on purpose. We
    # extend it with a custom branch below via monkeypatched method, but
    # cleaner: send through the existing complete() and rely on the
    # _raw_prompt fallthrough. Add a small adaptor here that bypasses
    # _build_prompt when the input has _raw_prompt.
    response = _complete_with_raw_prompt(backend, request)
    if response.insufficient_signal or not response.text:
        return JudgeResult(same=False, source="llm_refused",
                            confidence=0.0, raw=response.text or "")

    same, conf = _parse_judge(response.text)
    if same is None:
        return JudgeResult(same=False, source="llm_refused",
                            confidence=0.0, raw=response.text)
    return JudgeResult(same=same, source="llm", confidence=conf,
                       raw=response.text)


def _complete_with_raw_prompt(backend, request):
    """Bypass the backend's purpose-switched prompt when _raw_prompt is
    provided; otherwise defer to the backend's own complete(). This
    keeps the new "cluster_equivalence" purpose self-contained without
    editing llm_client.py."""
    import json
    import urllib.error
    import urllib.request

    raw_prompt = request.derived_input.get("_raw_prompt") if request.derived_input else None
    if not raw_prompt:
        return backend.complete(request)
    # Only OllamaBackend has the endpoint/model we want.
    if not hasattr(backend, "endpoint") or not hasattr(backend, "model"):
        return backend.complete(request)
    payload = json.dumps({
        "model": backend.model,
        "prompt": raw_prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 32,
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        backend.endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "Connection": "close"},
        method="POST",
    )
    from .llm_client import LlmResponse
    try:
        with urllib.request.urlopen(req, timeout=request.timeout_seconds) as r:
            data = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, json.JSONDecodeError):
        return LlmResponse.insufficient(reason="ollama_unreachable")
    text = (data.get("response") or "").strip()
    if not text:
        return LlmResponse.insufficient(reason="empty_response")
    return LlmResponse(text=text, confidence=0.7,
                       provenance=["label_a", "label_b", "app"])


def equivalence_pairs(
    clusters: list[dict[str, Any]],
    *,
    backend: LlmBackend | None = None,
    max_judge_calls: int = MAX_JUDGE_CALLS,
    top_k: int = TOP_K_CLUSTERS,
) -> list[tuple[int, int]]:
    """Return the list of (i, j) cluster-index pairs the judge said are
    the same activity. Indexes refer to the original `clusters` list.

    Process:
      1. Embed all cluster labels in one batch (cheap).
      2. For each same-app pair within the top-K by occurrence:
         - cos ≥ COSINE_OBVIOUS_YES → mark as SAME (skip LLM).
         - cos ≤ COSINE_OBVIOUS_NO → skip.
         - otherwise → ask the LLM (capped at max_judge_calls per session).
    """
    if len(clusters) < 2:
        return []

    backend = backend or get_default_backend()

    # 1. Embed.
    label_strs = [
        ((c.get("process_label") or "").strip() + " — " +
         (c.get("screen_label") or "").strip()).strip(" —")
        for c in clusters
    ]
    embeddings = embed_batch(label_strs) if embed_available() else [None] * len(clusters)

    # 2. Group by app, sort each app's clusters by frequency, take top-K.
    by_app: dict[str, list[int]] = {}
    for i, c in enumerate(clusters):
        by_app.setdefault(c.get("app") or "", []).append(i)
    for app, idxs in by_app.items():
        idxs.sort(key=lambda i: -clusters[i].get("occurrence_count", 0))
        by_app[app] = idxs[:top_k]

    # 3. Walk pairs, applying the cosine fast-path then the LLM judge.
    pairs: list[tuple[int, int]] = []
    judge_calls = 0
    for app, idxs in by_app.items():
        if len(idxs) < 2:
            continue
        for ai in range(len(idxs)):
            i = idxs[ai]
            for bi in range(ai + 1, len(idxs)):
                j = idxs[bi]
                # Cosine fast paths.
                cos = cosine_similarity(embeddings[i], embeddings[j]) \
                    if embeddings[i] and embeddings[j] else 0.0
                if cos >= COSINE_OBVIOUS_YES:
                    pairs.append((i, j))
                    continue
                if cos <= COSINE_OBVIOUS_NO:
                    continue
                # LLM judge.
                if judge_calls >= max_judge_calls:
                    continue
                judge_calls += 1
                la = clusters[i].get("process_label") or "(unnamed)"
                lb = clusters[j].get("process_label") or "(unnamed)"
                result = judge_pair(la, lb, app, backend=backend)
                if result.same:
                    pairs.append((i, j))
    return pairs
