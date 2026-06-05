"""Embeddings client — PDT-1.0-SPEC §3.1 semantic clustering augmentation.

Talks to Ollama's /api/embed with a small embedding model (all-minilm,
~45 MB, 384-dim). Used by the Pattern Layer's clustering pass to merge
exact-tuple clusters whose `process_label` strings are semantically
equivalent ("Submit", "Send", "Save record" → one cluster).

Hard rules mirror the LLM client (ADR-0028):
- Inputs are bounded structural strings (process_label, screen_label,
  app). Never raw event content.
- Graceful degrade: Ollama unreachable → empty embeddings list →
  Pattern Layer skips the merge and keeps the exact-tuple clusters.
- Best-effort per request: a failure on one string drops to None for
  that string, never raises.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

# Default embedding model. Pulled by scripts/bundle-ollama.ps1.
DEFAULT_EMBED_MODEL = os.environ.get("PDT_OLLAMA_EMBED_MODEL", "all-minilm")
# Probe + generate use the same base URL as the LLM client.
_EMBED_PATH = "/api/embed"
DEFAULT_TIMEOUT = 30.0


def _ollama_url() -> str:
    base = os.environ.get("PDT_OLLAMA_URL", "http://localhost:11434")
    return base.rstrip("/") + _EMBED_PATH


def _ollama_tags_url() -> str:
    base = os.environ.get("PDT_OLLAMA_URL", "http://localhost:11434")
    return base.rstrip("/") + "/api/tags"


def is_available() -> bool:
    """Probe whether the embed endpoint is reachable. Cached per-process."""
    try:
        with urllib.request.urlopen(_ollama_tags_url(), timeout=1.0) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        return False


def embed(text: str, *, model: str | None = None, timeout: float = DEFAULT_TIMEOUT) -> list[float] | None:
    """Return the embedding vector for a single string, or None on failure.

    Per the no-raw-events rule, `text` MUST be a bounded structural string
    (process_label, screen_label, app, vocab name, etc.). Callers are
    responsible for not passing event content here.
    """
    if not text or not isinstance(text, str):
        return None
    payload = json.dumps({
        "model": model or DEFAULT_EMBED_MODEL,
        "input": text,
    }).encode("utf-8")
    req = urllib.request.Request(
        _ollama_url(),
        data=payload,
        headers={"Content-Type": "application/json", "Connection": "close"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, json.JSONDecodeError):
        return None
    embeddings = data.get("embeddings") or []
    if not embeddings or not isinstance(embeddings, list):
        return None
    vec = embeddings[0]
    if not isinstance(vec, list):
        return None
    try:
        return [float(x) for x in vec]
    except (TypeError, ValueError):
        return None


def embed_batch(texts: list[str], *, model: str | None = None,
                timeout: float = DEFAULT_TIMEOUT) -> list[list[float] | None]:
    """Return a list of embedding vectors (or None) for each input string.

    Ollama's /api/embed accepts a list input — we batch for fewer
    round-trips. On total failure we fall back to per-string calls so a
    single bad input doesn't drop the rest.
    """
    if not texts:
        return []
    valid_indices = [i for i, t in enumerate(texts) if isinstance(t, str) and t]
    if not valid_indices:
        return [None] * len(texts)
    valid_texts = [texts[i] for i in valid_indices]
    payload = json.dumps({
        "model": model or DEFAULT_EMBED_MODEL,
        "input": valid_texts,
    }).encode("utf-8")
    req = urllib.request.Request(
        _ollama_url(),
        data=payload,
        headers={"Content-Type": "application/json", "Connection": "close"},
        method="POST",
    )
    out: list[list[float] | None] = [None] * len(texts)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        embeddings = data.get("embeddings") or []
        if len(embeddings) == len(valid_texts):
            for idx, vec in zip(valid_indices, embeddings):
                if isinstance(vec, list):
                    try:
                        out[idx] = [float(x) for x in vec]
                    except (TypeError, ValueError):
                        pass
            return out
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, json.JSONDecodeError):
        pass

    # Fallback: per-string. Slower but resilient.
    for idx in valid_indices:
        out[idx] = embed(texts[idx], model=model, timeout=timeout)
    return out


def cosine_similarity(a: list[float] | None, b: list[float] | None) -> float:
    """Cosine similarity in [-1, 1]. Returns 0.0 on any None or zero-norm."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))
