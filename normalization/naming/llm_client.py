"""LLM client backends for the Naming Layer — ADR-0028, PDT-1.0-SPEC §3.2.

Common interface for the two LLM uses (activity naming + PDD exec-summary).

Backends:
  - OllamaBackend: HTTP POST to a local Ollama server. Default.
  - NullBackend: returns INSUFFICIENT_SIGNAL on every call. Used when no
    LLM is available — graceful degrade. The Pattern-Layer outputs still
    display; only the LLM-derived names go missing.

All backends are stdlib-only (urllib, json). No anthropic / openai SDK
dependency in v1.0; cloud opt-in is deferred to a future ADR.

Hard rules enforced here (not at the call site):
  - The request payload structure is fixed: each request carries a
    short, bounded prompt + a JSON-shaped expected output spec. The
    backend NEVER receives raw events.
  - No-numbers-from-LLM is enforced in `LlmResponse.scrub_numbers()` —
    the post-processing strips any numerical tokens the model emitted.
  - Timeout and failure-mode behaviour is uniform: a backend failure
    returns a NullResponse, never raises.

Environment:
  PDT_OLLAMA_MODEL — override the default Ollama model tag. Set by
                     scripts/setup-ollama.ps1 when the user pulls a model.
  PDT_OLLAMA_URL   — override the default Ollama endpoint. Rarely needed.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol

from .confidence import INSUFFICIENT_SIGNAL


def _env_model_default() -> str:
    return os.environ.get("PDT_OLLAMA_MODEL", "llama3.1:8b-instruct")


def _env_endpoint_default() -> str:
    base = os.environ.get("PDT_OLLAMA_URL", "http://localhost:11434")
    return base.rstrip("/") + "/api/generate"


def _env_endpoint_tags() -> str:
    base = os.environ.get("PDT_OLLAMA_URL", "http://localhost:11434")
    return base.rstrip("/") + "/api/tags"


# ---- Request / response value objects ----

@dataclass
class LlmRequest:
    """A request for the Naming Layer.

    `purpose` is one of "activity_name" | "exec_summary" — the backend
    uses this to apply purpose-specific guardrails.

    `derived_input` is a dict of the structured input the LLM sees
    (never raw events). For activity_name: the cluster dict. For
    exec_summary: the process row dict.

    `timeout_seconds` covers BOTH the initial model-load-from-disk on the
    first request (Ollama lazily memory-maps the model) and subsequent
    fast generations. Local llama.cpp can take 20-60s for the first
    request when the model isn't yet warm, then ~2-5s thereafter.
    """
    purpose: str
    derived_input: dict[str, Any]
    timeout_seconds: float = 90.0


@dataclass
class LlmResponse:
    """A response from the Naming Layer.

    `text` is the model's output (sanitised — see `scrub_numbers`).
    `confidence` is in [0, 1] — derived from the model's stated
    confidence if available, else from input quality.
    `provenance` lists the input cues the model used (URLs of derived
    fields; never raw event ids).
    `insufficient_signal` is True if the layer refused to name.
    """
    text: str
    confidence: float = 0.0
    provenance: list[str] = field(default_factory=list)
    insufficient_signal: bool = False

    def scrub_numbers(self) -> "LlmResponse":
        """No-numbers-from-LLM rule (ADR-0028). Strip numerical tokens
        that aren't structural (e.g., "ServiceNow" stays; "12% confidence"
        gets removed). Conservative: removes any standalone digit sequence
        of length >= 2.

        Tokens adjacent to letters on either side (e.g., 'Office365',
        'IPv4') are part of a name, not a measurement — they stay.
        """
        if not self.text:
            return self
        # Match a number (with optional decimal + optional %) only when
        # both sides are NOT a word character — i.e., the number stands
        # alone. Using \w (which includes both letters and digits) ensures
        # that 'Office365' / 'IPv4' are preserved because the digits there
        # are preceded by a letter, while standalone '42' or '0.78' are
        # stripped.
        scrubbed = re.sub(
            r"(?<!\w)\d+(?:\.\d+)?%?(?!\w)",
            "",
            self.text,
        )
        scrubbed = re.sub(r"\s+", " ", scrubbed).strip()
        return LlmResponse(
            text=scrubbed,
            confidence=self.confidence,
            provenance=self.provenance,
            insufficient_signal=self.insufficient_signal,
        )

    @classmethod
    def insufficient(cls, reason: str = "") -> "LlmResponse":
        return cls(
            text=INSUFFICIENT_SIGNAL,
            confidence=0.0,
            provenance=[reason] if reason else [],
            insufficient_signal=True,
        )


# ---- Backend interface ----

class LlmBackend(Protocol):
    """Minimal protocol; backends just need to expose `complete()`."""

    def complete(self, request: LlmRequest) -> LlmResponse:
        ...


# ---- Null backend (no LLM available) ----

class NullBackend:
    """Graceful-degrade backend. Returns INSUFFICIENT_SIGNAL on every
    call. Lets the rest of the pipeline run when no LLM is reachable —
    the Pattern Layer's structural outputs survive."""

    def complete(self, request: LlmRequest) -> LlmResponse:
        return LlmResponse.insufficient(reason="no_llm_backend_available")


# ---- Ollama backend (local-first default) ----

class OllamaBackend:
    """Local Ollama HTTP backend. Default endpoint
    http://localhost:11434/api/generate.

    Model is configurable per instance; the spec recommends a small
    8–14B instruct model (llama3.1:8b-instruct or qwen2.5:14b-instruct).
    A missing/unreachable Ollama returns an LlmResponse.insufficient()
    rather than raising — graceful degrade.
    """

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        model: str | None = None,
        timeout_seconds: float = 90.0,
    ) -> None:
        self.endpoint = endpoint or _env_endpoint_default()
        self.model = model or _env_model_default()
        self.timeout_seconds = timeout_seconds

    def _build_prompt(self, request: LlmRequest) -> str:
        """Build a purpose-specific prompt over the derived input.
        Hard rules baked into every prompt:
          - Output is plain text, short, no numbers.
          - If the input is ambiguous, return exactly INSUFFICIENT_SIGNAL.
          - No quotation marks, no Markdown.
        """
        purpose = request.purpose
        d = request.derived_input or {}
        if purpose == "activity_name":
            pl = (d.get("process_label") or "").strip()
            scr = (d.get("screen_label") or "").strip()
            app = (d.get("app") or "").strip()
            vocab = ", ".join(d.get("vocab_names") or [])
            # The smallest prompt that still produces names on a 1.5B model.
            # Heavier prompts trigger refusal cascades on these models — the
            # less we say, the more reliably it paraphrases. INSUFFICIENT
            # remains the escape hatch but we only invoke it when truly
            # nothing was passed.
            if not pl and not scr and not app:
                return INSUFFICIENT_SIGNAL
            head = f"Process label: {pl}" if pl else (
                f"Screen / window: {scr}" if scr else f"Application: {app}")
            extras = []
            if pl and scr:
                extras.append(f"Screen / window: {scr}")
            if app:
                extras.append(f"Application: {app}")
            if vocab:
                extras.append(f"Vocab cues: {vocab}")
            block = "\n".join([head] + extras)
            return (
                "Paraphrase the process label below into a 2-4 word business "
                "activity name. Stay close to the literal label; do NOT invent "
                "context. Examples: 'Incident: Save record' -> 'Save Incident'; "
                "'RE: Send' -> 'Send Email'; 'Invoice.xlsx: Save workbook' -> "
                "'Save Workbook'. No numbers, no quotation marks.\n"
                f"{block}\n"
                "Activity name:"
            )
        if purpose == "exec_summary":
            cues = []
            if d.get("activity_labels"):
                cues.append("- Observed activity labels: "
                            + ", ".join(d.get("activity_labels") or [])[:400])
            if d.get("screen_labels"):
                cues.append("- Observed window/screen contexts: "
                            + ", ".join(d.get("screen_labels") or [])[:400])
            if d.get("interaction_types"):
                cues.append("- Recognised interaction types: "
                            + ", ".join(d.get("interaction_types") or []))
            cues_block = "\n".join(cues) if cues else "- (no further structural cues)"
            return (
                "You are summarising a recurring desktop work pattern for an "
                "engagement deliverable. Write 2-3 short sentences that "
                "describe ONLY what the captured cues directly support.\n"
                "\nHARD RULES (violating any returns "
                f"{INSUFFICIENT_SIGNAL}):\n"
                "  1. Do NOT invent stakeholders, purposes, motivations, "
                "consequences, beneficiaries, or downstream effects.\n"
                "  2. Do NOT use words like 'executive', 'team', 'stakeholder', "
                "'professional', 'crucial', 'essential', 'ensures', "
                "'maintains', 'productivity', 'strategic', 'integrity'.\n"
                "  3. Do NOT speculate about why a worker does this or what "
                "would happen if it broke.\n"
                "  4. Stick to what apps and labels say literally.\n"
                "  5. No numbers, percentages, durations, or counts.\n"
                "  6. If the cues do not contain enough literal evidence for a "
                "concrete description, reply with exactly "
                f"{INSUFFICIENT_SIGNAL} and nothing else.\n"
                "\nCues you may use (and ONLY these):\n"
                f"- Process label: {d.get('label', '(unnamed process)')}\n"
                f"- Applications observed: "
                f"{', '.join(d.get('apps') or []) or '(unknown)'}\n"
                f"{cues_block}\n"
                "\nWrite the 2-3 sentence description now, or "
                f"{INSUFFICIENT_SIGNAL} if you cannot stay literal:"
            )
        # Unknown purpose — refuse
        return INSUFFICIENT_SIGNAL

    def complete(self, request: LlmRequest) -> LlmResponse:
        prompt = self._build_prompt(request)
        if prompt == INSUFFICIENT_SIGNAL:
            return LlmResponse.insufficient(reason="unknown_purpose")

        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,    # low — we want consistent naming
                "num_predict": 200 if request.purpose == "exec_summary" else 32,
            },
        }
        body = json.dumps(payload).encode("utf-8")
        # Use the larger of the request's timeout and the backend default —
        # the first call needs the model load budget. Connection: close
        # avoids stale keep-alive sockets when Ollama recycles.
        timeout = max(request.timeout_seconds or 0, self.timeout_seconds)
        req = urllib.request.Request(
            self.endpoint,
            data=body,
            headers={"Content-Type": "application/json", "Connection": "close"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            return LlmResponse.insufficient(reason="ollama_unreachable")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return LlmResponse.insufficient(reason="ollama_invalid_json")

        text = (data.get("response") or "").strip()
        if not text or text.lower().startswith(INSUFFICIENT_SIGNAL.lower()):
            return LlmResponse.insufficient(reason="model_refused")

        # Strip surrounding quotes and Markdown bullets the model might add.
        text = text.strip().strip("\"'`").lstrip("-* ").strip()

        # Provenance: the cue keys we passed in.
        provenance = sorted(k for k in (request.derived_input or {}).keys()
                            if request.derived_input.get(k))

        # Best-effort confidence: derived from input quality (cluster
        # confidence if present). The LLM doesn't reliably self-report
        # confidence on local models.
        confidence = float(request.derived_input.get("confidence", 0.0) or 0.0)
        if confidence <= 0:
            confidence = 0.55   # default modest confidence

        return LlmResponse(
            text=text,
            confidence=min(1.0, max(0.0, confidence)),
            provenance=provenance,
            insufficient_signal=False,
        ).scrub_numbers()


# ---- Default-backend resolution ----

_default_backend: LlmBackend | None = None


def get_default_backend() -> LlmBackend:
    """Return the cached default backend.

    First call: probes Ollama briefly; if reachable, returns OllamaBackend.
    If not, returns NullBackend (graceful degrade).

    Cached so the probe runs at most once per process. The Cockpit and
    PDD exporter both call into this; we don't want them probing twice.
    """
    global _default_backend
    if _default_backend is not None:
        return _default_backend

    # Quick reachability probe.
    backend: LlmBackend = NullBackend()
    try:
        with urllib.request.urlopen(
            _env_endpoint_tags(), timeout=1.0
        ) as resp:
            if resp.status == 200:
                backend = OllamaBackend()
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        backend = NullBackend()

    _default_backend = backend
    return backend


def reset_default_backend() -> None:
    """For tests — clear the cache so the next call re-probes."""
    global _default_backend
    _default_backend = None
