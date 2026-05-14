"""App Vocabularies (ADR-0002).

Per-app per-interaction annotations: a button's automation_id maps to a
meaningful name, independent of which business process the captured
session belongs to.

Pipeline placement: between case assignment and step suggestion. Each
matched interaction event gets enriched with:
  data.meaningful_name  -- analyst's name for this interaction
  data.screen_id        -- optional named-screen membership
  data.vocab_flags      -- defaults carried over to step flags
  data.vocab_source     -- { vocab_id, vocab_version } for traceability

See `docs/adr/0002-app-vocabularies.md` for the design rationale.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml


DEFAULT_DIR = Path(__file__).resolve().parent / "app_vocabularies"


# --- Loading -----------------------------------------------------------

def _vocab_dirs() -> list[Path]:
    """Default ships at normalization/app_vocabularies/.
    PDT_APP_VOCABULARIES is a path-separator delimited list of extra dirs.
    """
    out: list[Path] = []
    if DEFAULT_DIR.is_dir():
        out.append(DEFAULT_DIR)
    extra = os.environ.get("PDT_APP_VOCABULARIES", "")
    if extra:
        for raw in extra.replace(";", os.pathsep).split(os.pathsep):
            raw = raw.strip()
            if not raw:
                continue
            p = Path(raw)
            if p.is_dir():
                out.append(p)
    return out


def load_vocabularies(extra_dirs: list[str] | None = None) -> list[dict[str, Any]]:
    """Load every *.yaml under the default dir and any extra dirs.

    Returns the parsed vocabularies in load order (alphabetical within
    each dir, dirs in order). Malformed files are silently skipped --
    a single bad vocab should never break normalization.
    """
    dirs = _vocab_dirs()
    for d in (extra_dirs or []):
        p = Path(d)
        if p.is_dir():
            dirs.append(p)
    vocabs: list[dict[str, Any]] = []
    seen_files: set[str] = set()
    for d in dirs:
        for f in sorted(d.glob("*.yaml")):
            rp = str(f.resolve())
            if rp in seen_files:
                continue
            seen_files.add(rp)
            try:
                with open(f, encoding="utf-8") as fh:
                    raw = yaml.safe_load(fh) or {}
                v = raw.get("app_vocabulary")
                if not isinstance(v, dict):
                    continue
                v["_source_path"] = rp
                vocabs.append(v)
            except (OSError, yaml.YAMLError):
                continue
    return vocabs


# --- Matching engine ---------------------------------------------------

def _compile_regex(pattern: str | None):
    if not pattern:
        return None
    try:
        return re.compile(pattern)
    except re.error:
        return None


def _scope_matches(vocab: dict, ev_data: dict) -> bool:
    """An interaction enters a vocab's domain when the vocab's scope
    matches the event. Empty scope matches everything (a "catch-all"
    vocab is legal but probably a mistake)."""
    scope = vocab.get("scope") or {}
    pn = scope.get("process_name")
    if pn and ev_data.get("process_name") != pn:
        return False
    wtr = scope.get("window_title_regex")
    if wtr:
        r = _compile_regex(wtr)
        if r is None: return False
        if not r.search(ev_data.get("window_title") or ""):
            return False
    return True


_SIG_FIELDS = ("control_type", "automation_id", "name", "class_name", "framework_id")


def _signature_match(sig: dict, ev_data: dict) -> tuple[bool, int]:
    """Return (matches, specificity). Specificity is the number of
    non-empty signature fields that participated in the match."""
    if not sig:
        return False, 0
    specificity = 0
    for f in _SIG_FIELDS:
        want = sig.get(f)
        if want is None or want == "":
            continue
        if ev_data.get(f) != want:
            return False, 0
        specificity += 1
    wtr = sig.get("window_title_regex")
    if wtr:
        r = _compile_regex(wtr)
        if r is None or not r.search(ev_data.get("window_title") or ""):
            return False, 0
        specificity += 1
    return specificity > 0, specificity


def _resolve_screen(vocab: dict, screen_id: str | None, ev_data: dict) -> str | None:
    """Pick a screen for this event. The entry's `screen` field wins
    if present. Otherwise look for a screen whose window_title_regex
    matches."""
    if screen_id:
        return screen_id
    for s in (vocab.get("screens") or []):
        wtr = s.get("window_title_regex")
        if not wtr:
            continue
        r = _compile_regex(wtr)
        if r and r.search(ev_data.get("window_title") or ""):
            return s.get("id")
    return None


def _best_entry(vocab: dict, ev_data: dict) -> tuple[dict | None, int]:
    """Return (best_entry, specificity) for one vocab. Most-specific wins;
    ties broken by first-defined."""
    best = None
    best_spec = -1
    for entry in (vocab.get("interactions") or []):
        sig = entry.get("signature") or {}
        ok, spec = _signature_match(sig, ev_data)
        if ok and spec > best_spec:
            best = entry
            best_spec = spec
    return best, best_spec


def lookup(vocabs: list[dict], ev_data: dict) -> dict | None:
    """Apply the layered matcher. Returns an enrichment dict or None.

    Order:
      1. Filter vocabs by scope match.
      2. Within each scoped vocab, pick the most-specific signature match.
      3. Across vocabs, the most-specific overall match wins.
         Ties broken by vocab load order (first-loaded wins).
    """
    best_entry = None
    best_vocab = None
    best_spec = -1
    for v in vocabs:
        if not _scope_matches(v, ev_data):
            continue
        entry, spec = _best_entry(v, ev_data)
        if entry and spec > best_spec:
            best_entry = entry
            best_vocab = v
            best_spec = spec
    if not best_entry:
        return None
    return {
        "meaningful_name": best_entry.get("name"),
        "screen_id": _resolve_screen(best_vocab, best_entry.get("screen"), ev_data),
        "vocab_flags": dict(best_entry.get("flags") or {}),
        "vocab_source": {
            "vocab_id": best_vocab.get("id"),
            "vocab_version": best_vocab.get("version", 1),
        },
    }


def enrich_events(
    events: list[dict[str, Any]],
    vocabs: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Walk events; for each interaction, look up the vocab annotation
    and merge enrichment fields into event.data.

    Returns (events, summary) where summary is:
      { matched, total, vocabs_hit: { vocab_id: count } }
    The events list itself is mutated for performance (event dicts are
    not shared across pipeline stages in normalize.py).
    """
    if vocabs is None:
        vocabs = load_vocabularies()
    total = 0
    matched = 0
    hit: dict[str, int] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        total += 1
        enrich = lookup(vocabs, ev.get("data") or {})
        if not enrich:
            continue
        ev["data"].update({k: v for k, v in enrich.items() if v is not None and v != {}})
        matched += 1
        vid = enrich["vocab_source"]["vocab_id"]
        hit[vid] = hit.get(vid, 0) + 1
    summary = {
        "matched": matched,
        "total": total,
        "vocabs_loaded": [
            {"id": v.get("id"), "version": v.get("version", 1)} for v in vocabs
        ],
        "vocabs_hit": hit,
    }
    return events, summary


# --- Bootstrap-from-session authoring -----------------------------------

def bootstrap_from_session(
    events: list[dict[str, Any]],
    *,
    vocab_id: str = "untitled",
    vocab_name: str = "Untitled",
) -> dict[str, Any]:
    """Build a starter vocabulary YAML by deduplicating the unique
    interaction signatures observed in a session.

    Strategy:
      - Group events by (process_name) -- the most stable scope key.
        For now we emit one vocabulary; multi-process splitting is the
        analyst's job in post-editing.
      - Within a group, dedup events by the most-specific available
        signature: prefer automation_id, then (control_type, name),
        then class_name+name. Carry a count for analyst sizing.
      - Leave `name` field blank with a hint (the raw control name) so
        the analyst fills it in. Don't guess -- we'd just be lying.
    """
    if not events:
        return {
            "app_vocabulary": {
                "id": vocab_id, "name": vocab_name, "version": 1,
                "scope": {}, "interactions": [],
            }
        }
    by_proc: dict[str, list[dict]] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        d = ev.get("data") or {}
        pn = d.get("process_name") or "(unknown)"
        by_proc.setdefault(pn, []).append(d)

    # Most-frequent process is the assumed app for the vocab.
    dominant_proc = max(by_proc.keys(), key=lambda k: len(by_proc[k]))
    titles = [d.get("window_title") for d in by_proc[dominant_proc] if d.get("window_title")]
    title_prefix = _common_prefix(titles) if titles else ""

    scope: dict[str, Any] = {"process_name": dominant_proc}
    if title_prefix and len(title_prefix) >= 3:
        # Use the common prefix as the window scope, escaped for regex.
        scope["window_title_regex"] = f".*{re.escape(title_prefix.strip())}.*"

    # Dedup interactions by signature key, keep an example raw name.
    seen: dict[tuple, dict] = {}
    for d in by_proc[dominant_proc]:
        key = _signature_key(d)
        if key is None:
            continue
        entry = seen.get(key)
        if entry:
            entry["_count"] += 1
            continue
        sig = _signature_from_event(d)
        if not sig:
            continue
        seen[key] = {
            "signature": sig,
            "_count": 1,
            "_raw_name": d.get("name") or d.get("automation_id") or "",
        }

    interactions = []
    for v in sorted(seen.values(), key=lambda x: -x["_count"]):
        item = {"signature": v["signature"], "name": ""}
        hint = v["_raw_name"]
        if hint:
            # Stash a hint as a YAML comment in name -- analyst will overwrite.
            item["name"] = ""
            item["_hint"] = f"raw: {hint!r} ({v['_count']}x)"
        interactions.append(item)

    return {
        "app_vocabulary": {
            "id": vocab_id,
            "name": vocab_name,
            "version": 1,
            "scope": scope,
            "interactions": interactions,
        }
    }


def _signature_key(d: dict) -> tuple | None:
    """Deterministic key for deduplication. Prefers automation_id."""
    aid = d.get("automation_id")
    if aid:
        return ("aid", d.get("process_name"), aid)
    ct = d.get("control_type")
    name = d.get("name")
    if ct and name:
        return ("ctn", d.get("process_name"), ct, name)
    cn = d.get("class_name")
    if cn and name:
        return ("cnn", d.get("process_name"), cn, name)
    if name:
        return ("n", d.get("process_name"), name)
    return None


def _signature_from_event(d: dict) -> dict | None:
    """Pick the minimum signature that uniquely identifies the interaction.

    automation_id (if present and non-empty) is the most stable handle
    and is preferred alone. Otherwise use control_type+name.
    """
    aid = d.get("automation_id")
    if aid:
        ct = d.get("control_type")
        sig = {"automation_id": aid}
        if ct:
            sig["control_type"] = ct
        return sig
    ct = d.get("control_type")
    name = d.get("name")
    if ct and name:
        return {"control_type": ct, "name": name}
    cn = d.get("class_name")
    if cn and name:
        return {"class_name": cn, "name": name}
    if name:
        return {"name": name}
    return None


def _common_prefix(strings: list[str]) -> str:
    """Longest common prefix across a list of strings. Empty list => ''."""
    if not strings:
        return ""
    s1 = min(strings)
    s2 = max(strings)
    for i, c in enumerate(s1):
        if i >= len(s2) or c != s2[i]:
            return s1[:i]
    return s1


# --- YAML emission -----------------------------------------------------

def to_yaml(doc: dict[str, Any]) -> str:
    """Emit the vocabulary as YAML, lifting `_hint` into a trailing
    comment per interaction so the analyst sees the raw signal."""
    base = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120)
    lines = base.splitlines()
    out: list[str] = []
    pending_hint = None
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("_hint:"):
            pending_hint = stripped[len("_hint:"):].strip().strip("'\"")
            continue
        out.append(line)
        if pending_hint and stripped.startswith("- signature:"):
            # Hint applies to the entry just opened.
            indent = line[: len(line) - len(line.lstrip())]
            out.append(f"{indent}  # {pending_hint}")
            pending_hint = None
    # Any orphan hint at the end -- ignore.
    return "\n".join(out) + ("\n" if not base.endswith("\n") else "")
