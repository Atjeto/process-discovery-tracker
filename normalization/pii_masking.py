"""Structural PII masking (§11f) -- redact sensitive UIA field VALUES.

Privacy by *field*, not by OCR: a value typed into a control whose name /
automation_id / control_type matches a sensitive pattern (password, SSN, card
number, CVV, PIN, secret/token, IBAN, routing/account number) is replaced in
the DERIVED event stream with a redaction token. The raw `events.jsonl` is
NEVER rewritten -- `normalize.py` only ever reads it -- so masking applies to
the in-memory copy that feeds `events.csv`, `events.xes`, `stats.json`, the
steps, the analysis layer, and the mined maps. This is the structural
counterpart to OCR redaction: it knows *which field* held the secret, so it is
exact rather than a pixel-region guess.

Redaction is a one-way, join-preserving token::

    «<category>#<8-hex>»     e.g.  «password#3f9a1c0e»

where the hash is ``sha256(session_id + ":" + value)[:8]``. Two different
secrets within a session map to different tokens (process mining still tells
them apart), the same secret maps to the same token (joins survive), and the
original value is not recoverable from the token. The `<category>` names which
rule fired, so the analyst can see *what* was redacted without seeing it.

The rule-set that ran is recorded in the additive `pii_masking` annotations key
(Python owns it; regenerated every run). An analyst can disable masking or add
patterns through the separate analyst-owned `pii_masking_config` key.

stdlib-only on purpose (hashlib + re) so the unit test runs under a bare Python
with no pipeline deps.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

RULESET_ID = "default"
# Bump when the default rules change in a way that should invalidate a prior
# pii_masking report's comparability -- same contract as marker_suggest's
# heuristic_version.
RULESET_VERSION = 1

# (category, pattern). Matched case-insensitively against a haystack of the
# field's name + automation_id + control_type. Word-ish boundaries avoid false
# positives like "shipping" matching a bare "pin".
_DEFAULT_RULES: list[tuple[str, str]] = [
    ("password", r"\b(pass\s?word|passwd|pwd)\b"),
    ("ssn",      r"\b(ssn|social\s*security)\b"),
    ("card",     r"\b(credit\s*card|card\s*(?:no|num|number)|cardnum|ccnum|\bpan\b)\b"),
    ("cvv",      r"\b(cvv2?|cvc|card\s*verification)\b"),
    ("pin",      r"\bpin\b"),
    ("secret",   r"\b(secret|api[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|bearer)\b"),
    ("iban",     r"\biban\b"),
    ("routing",  r"\b(routing\s*(?:no|number)|sort\s*code)\b"),
    ("account",  r"\b(account\s*(?:no|num|number)|acct\s*(?:no|num|number))\b"),
]


def _compile_rules(annotations: dict | None) -> tuple[list[tuple[str, Any]], int]:
    """Compile the default rules plus any analyst `pii_masking_config.custom_rules`.
    A malformed custom regex is skipped, not fatal."""
    rules: list[tuple[str, Any]] = []
    for cat, pat in _DEFAULT_RULES:
        try:
            rules.append((cat, re.compile(pat, re.IGNORECASE)))
        except re.error:
            pass
    n_custom = 0
    cfg = (annotations or {}).get("pii_masking_config")
    custom = cfg.get("custom_rules") if isinstance(cfg, dict) else None
    if isinstance(custom, list):
        for r in custom:
            if not isinstance(r, dict):
                continue
            pat = r.get("pattern")
            if not isinstance(pat, str) or not pat:
                continue
            cat = str(r.get("id") or r.get("category") or "custom")
            try:
                rules.append((cat, re.compile(pat, re.IGNORECASE)))
                n_custom += 1
            except re.error:
                pass
    return rules, n_custom


_CAMEL_1 = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_CAMEL_2 = re.compile(r"(?<=[A-Z])(?=[A-Z][a-z])")
_NONWORD = re.compile(r"[^A-Za-z0-9]+")


def _tokenize(s: str) -> str:
    """Normalise an identifier or label into space-separated lowercase tokens,
    splitting on camelCase and separators so word-boundary rules fire on the
    concatenated forms UIA actually emits. "PasswordBox" -> "password box";
    "txtSSN" -> "txt ssn"; "Spinner" stays one token (so a bare-"pin" rule
    can't false-positive on it)."""
    s = _CAMEL_1.sub(" ", s)
    s = _CAMEL_2.sub(" ", s)
    return _NONWORD.sub(" ", s).strip().lower()


def _category_for(data: dict, rules: list[tuple[str, Any]]) -> str | None:
    """Return the first matching rule category for an interaction's data, or
    None if no sensitive-field pattern matches. The field name / automation_id /
    control_type are tokenized so concatenated identifiers match cleanly."""
    hay = " ".join((
        _tokenize(str(data.get("name") or "")),
        _tokenize(str(data.get("automation_id") or "")),
        _tokenize(str(data.get("control_type") or "")),
    ))
    for cat, rx in rules:
        if rx.search(hay):
            return cat
    return None


def _token(value: Any, category: str, session_id: str) -> str:
    h = hashlib.sha256(
        (str(session_id) + ":" + str(value)).encode("utf-8", "replace")
    ).hexdigest()[:8]
    return f"«{category}#{h}»"


def mask_events(
    events: list[dict[str, Any]] | None,
    annotations: dict | None = None,
    session_id: str = "",
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Redact sensitive field values in a COPY of the event stream.

    Returns ``(masked_events, report)``. The input list and its event dicts are
    never mutated -- masked interactions are shallow-copied with a fresh `data`
    dict -- so the caller's `raw` / immutable references stay intact. The report
    is the `pii_masking` annotations block: which rule-set ran, how many values
    were redacted, and the per-category counts.
    """
    cfg = (annotations or {}).get("pii_masking_config")
    enabled = not (isinstance(cfg, dict) and cfg.get("enabled") is False)
    rules, n_custom = _compile_rules(annotations)

    report: dict[str, Any] = {
        "ruleset_id": RULESET_ID,
        "ruleset_version": RULESET_VERSION,
        "enabled": enabled,
        "applied": False,
        "scanned_interactions": 0,
        "masked_value_count": 0,
        "rules_fired": {},
        "custom_rule_count": n_custom,
    }
    if not enabled or not isinstance(events, list):
        return (events if isinstance(events, list) else []), report

    out: list[dict[str, Any]] = []
    scanned = 0
    masked = 0
    fired: dict[str, int] = {}
    for ev in events:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            out.append(ev)
            continue
        data = ev.get("data")
        if not isinstance(data, dict):
            out.append(ev)
            continue
        scanned += 1
        cat = _category_for(data, rules)
        if cat is None:
            out.append(ev)
            continue
        new_data: dict | None = None
        for key in ("value", "selected_value"):
            v = data.get(key)
            if isinstance(v, str) and v != "":
                if new_data is None:
                    new_data = dict(data)
                new_data[key] = _token(v, cat, session_id)
        if new_data is None:
            # Sensitive field, but no value to redact (e.g. a focus event).
            out.append(ev)
            continue
        new_data["value_masked"] = True
        new_data["value_masked_rule"] = cat
        new_ev = dict(ev)
        new_ev["data"] = new_data
        out.append(new_ev)
        masked += 1
        fired[cat] = fired.get(cat, 0) + 1

    report["applied"] = True
    report["scanned_interactions"] = scanned
    report["masked_value_count"] = masked
    report["rules_fired"] = fired
    return out, report
