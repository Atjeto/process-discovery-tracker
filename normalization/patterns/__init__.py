"""Pattern Layer (ADR-0029) — classical sequence mining + clustering + anomaly +
case-inference detectors over a normalized session.

Phase 2 surfacing for PDT 1.0 (docs/PDT-1.0-SPEC.md §3.1). The orchestrator
`detect_patterns()` runs the four detectors in order and returns a single
JSON-serialisable dict that is written to ``<session>/patterns.json`` by the
pipeline. Pure stdlib — no pandas, no numpy, no sklearn — so the bundled
``viewer/python/`` can run it.

Hard rules (mirrored from the spec):
- All IDs are stable hashes of content (blake2b, hexdigest()[:12]).
- All confidence scores in [0, 1].
- All timestamps in returned dicts are ISO strings, never datetime objects.
- The layer is best-effort: a detector exception must not crash the pipeline
  (the pipeline-stage wrapper handles that).
"""
from __future__ import annotations

from .pattern_layer import detect_patterns  # noqa: F401

__all__ = ["detect_patterns"]
