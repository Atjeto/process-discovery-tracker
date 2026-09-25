"""What the Overview's rows were measured from (lane CC).

The rows of the PDD's sections 5 and 6, which analysis.json holds as
`pdd_data` and `pdd_time`, are measured from the steps; the analyst can
change the steps after an analysis (a rename in Steps). The pipeline records
the signature of the steps it measured (`steps_signature`), the viewer
computes the same signature over the steps it has (viewer/rows-freshness.js),
and the Overview analyzes again as it opens when the two differ. Pinned with
the viewer by shared/steps-signature-golden.json.

The signature is the SHA-256 (hex) of one JSON text: the reference
transaction's case id, then every step in the list's order as the fields the
rows read (its id, transaction, name, state, time range, order, system,
draft keys and recorded interactions), its sub-steps the same way. Typing in
the document never changes it, and neither does a step's description, notes,
flow or screenshots.
"""

from __future__ import annotations

import hashlib
import json
import math
import re

# JSON.stringify writes a lone surrogate as an escape; so does this.
_SURROGATE = re.compile("[\ud800-\udfff]")


def _text(value):
    return value if isinstance(value, str) else None


def _number(value):
    """A number the way JSON.stringify writes it: a whole float as an integer
    (2.0 reads 2 in the viewer), no bool, nothing that is not finite."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer():
            return int(value)
    return value


def _texts(value):
    return [_text(v) for v in value] if isinstance(value, list) else None


def _step_row(step):
    if not isinstance(step, dict):
        return None
    span = step.get("time_range") if isinstance(step.get("time_range"), dict) else {}
    evidence = step.get("evidence") if isinstance(step.get("evidence"), dict) else {}
    subs = step.get("sub_steps")
    return [_text(step.get("step_id")), _text(step.get("case_id")), _text(step.get("name")),
            _text(step.get("state")), _text(span.get("start")), _text(span.get("end")),
            _number(step.get("order")), _text(step.get("system")), _text(step.get("draft_key")),
            _texts(step.get("draft_keys")), _texts(evidence.get("interaction_event_ids")),
            [_step_row(s) for s in subs] if isinstance(subs, list) else None]


def signature_text(annotations) -> str:
    """The JSON text the signature is taken of (the viewer builds the same
    text with JSON.stringify)."""
    anno = annotations if isinstance(annotations, dict) else {}
    pattern = anno.get("pattern_run") if isinstance(anno.get("pattern_run"), dict) else {}
    steps = anno.get("steps") if isinstance(anno.get("steps"), list) else []
    text = json.dumps([_text(pattern.get("case_id")), [_step_row(s) for s in steps]],
                      ensure_ascii=False, separators=(",", ":"))
    return _SURROGATE.sub(lambda m: "\\u%04x" % ord(m.group()), text)


def steps_signature(annotations) -> str:
    """The signature of the steps (and the reference transaction) of one
    annotations object."""
    return hashlib.sha256(signature_text(annotations).encode("utf-8")).hexdigest()
