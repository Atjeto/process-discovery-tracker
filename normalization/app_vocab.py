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
import sys
from pathlib import Path
from typing import Any

import yaml

import regex_guard


DEFAULT_DIR = Path(__file__).resolve().parent / "app_vocabularies"


def _warn(msg: str) -> None:
    """A stderr warning so a bad vocab is visible (not silently swallowed)
    without breaking the normalization run."""
    print(f"[normalize] WARNING: {msg}", file=sys.stderr)


def _lint_vocab_regexes(v: dict, source: str) -> None:
    """Warn once per ReDoS-prone authored regex in a loaded vocab (scope /
    screens / interaction signatures). The runtime guard in _compile_regex
    already makes such a pattern inert (it won't match), but the analyst should
    know their pattern was rejected."""
    def check(pat, where):
        if isinstance(pat, str) and pat and regex_guard.is_redos_prone(pat):
            _warn(f"app vocabulary {source}: ignoring ReDoS-prone regex at "
                  f"{where}: {pat!r}")
    check((v.get("scope") or {}).get("window_title_regex"), "scope")
    for s in (v.get("screens") or []):
        if isinstance(s, dict):
            check(s.get("window_title_regex"), f"screen {s.get('id')!r}")
    for e in (v.get("interactions") or []):
        if isinstance(e, dict):
            check((e.get("signature") or {}).get("window_title_regex"),
                  "interaction signature")


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
                _lint_vocab_regexes(v, f.name)
                vocabs.append(v)
            except (OSError, yaml.YAMLError) as e:
                _warn(f"skipping malformed app vocabulary {rp}: {e}")
                continue
    return vocabs


# --- Semantic layer (lab-phase C1) --------------------------------------
#
# Optional, additive per-interaction fields. A vocab written before these
# existed loads and matches identically (every field is read with .get and
# absent means "no semantic"); a vocab carrying them reaches the derived
# stream as data.vocab_semantics, where two consumers read it:
#   completion      -> a step-boundary hint in step_suggest (a step ends when
#                      the control completes the unit of work),
#   carries_value   -> widens the rekey detector's field set (facts.rekey_details).
# verb / object / case_id_source / means are authored meaning, carried along.

SEMANTIC_FIELDS = (
    "verb", "object", "completion", "case_id_source", "carries_value", "means",
)


def semantics_from_entry(entry: dict) -> dict[str, Any]:
    """The semantic fields an authored entry actually carries (absent /
    empty fields stay absent -- old vocabs produce {})."""
    out: dict[str, Any] = {}
    for k in SEMANTIC_FIELDS:
        v = entry.get(k)
        if v is None or v == "":
            continue
        out[k] = v
    return out


# --- Matching engine ---------------------------------------------------

def _compile_regex(pattern: str | None):
    # Route through the ReDoS guard: an authored window_title_regex is matched
    # against untrusted window titles, so a nested unbounded quantifier is
    # rejected (returns None -> treated as non-matching) rather than risking
    # catastrophic backtracking. Invalid patterns also return None, as before.
    return regex_guard.compile_guarded(pattern)


def _as_dict(x: Any) -> dict:
    """A dict view of `x`, or {} when it isn't one. Malformed YAML can put a
    string/list/None where the matcher expects a dict (load_vocabularies only
    catches PARSE errors, not a structurally-wrong-but-valid vocab); an odd
    capture can emit a non-dict event `data`. Guarding here degrades to
    no-match instead of an AttributeError that would crash normalization."""
    return x if isinstance(x, dict) else {}


def _scope_matches(vocab: dict, ev_data: dict) -> bool:
    """An interaction enters a vocab's domain when the vocab's scope
    matches the event. Empty scope matches everything (a "catch-all"
    vocab is legal but probably a mistake)."""
    scope = _as_dict(_as_dict(vocab).get("scope"))
    ev_data = _as_dict(ev_data)
    pn = scope.get("process_name")
    if pn:
        # process_name is matched case-insensitively: the OS / recorder reports
        # the executable name with inconsistent casing (e.g. "chrome.exe" but
        # "EXCEL.EXE" / "SAPGUI.exe"), so a case-sensitive compare would make a
        # vocab silently miss the very app it targets.
        ev_pn = ev_data.get("process_name")
        if not isinstance(ev_pn, str) or ev_pn.lower() != str(pn).lower():
            return False
    wtr = scope.get("window_title_regex")
    if wtr:
        r = _compile_regex(wtr)
        if r is None: return False
        if not r.search(str(ev_data.get("window_title") or "")):
            return False
    return True


_SIG_FIELDS = ("control_type", "automation_id", "name", "class_name", "framework_id")


def _signature_match(sig: dict, ev_data: dict) -> tuple[bool, int]:
    """Return (matches, specificity). Specificity is the number of
    non-empty signature fields that participated in the match."""
    sig = _as_dict(sig)
    ev_data = _as_dict(ev_data)
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
        if r is None or not r.search(str(ev_data.get("window_title") or "")):
            return False, 0
        specificity += 1
    return specificity > 0, specificity


def _resolve_screen(vocab: dict, screen_id: str | None, ev_data: dict) -> str | None:
    """Pick a screen for this event. The entry's `screen` field wins
    if present. Otherwise look for a screen whose window_title_regex
    matches."""
    if screen_id:
        return screen_id
    ev_data = _as_dict(ev_data)
    for s in (_as_dict(vocab).get("screens") or []):
        if not isinstance(s, dict):
            continue
        wtr = s.get("window_title_regex")
        if not wtr:
            continue
        r = _compile_regex(wtr)
        if r and r.search(str(ev_data.get("window_title") or "")):
            return s.get("id")
    return None


def _screen_by_window(vocabs: list[dict], ev_data: dict) -> str | None:
    """The vocab `screen_id` whose `window_title_regex` matches this event's
    window, independent of any control-signature match (ADR-0024 §6b).

    Used to tag a CONSISTENT screen on interactions whose specific control isn't
    in the vocab: otherwise a step with no vocab-matched control falls back to the
    raw `window_title` in step_grain_keys, so one logical screen splits into a
    distinct per-case node (e.g. an Incident form is `incident` for the matched
    fields but `Create INC0010010 | Incident | ServiceNow` for the unmatched
    ones) and the screen-grain map fans out. Honouring the screen's
    window_title_regex for every in-scope interaction keeps one screen one node.
    Returns the first matching scoped vocab's screen id, else None.
    """
    for v in vocabs:
        if not _scope_matches(v, ev_data):
            continue
        sid = _resolve_screen(v, None, ev_data)
        if sid:
            return sid
    return None


def _best_entry(vocab: dict, ev_data: dict) -> tuple[dict | None, int]:
    """Return (best_entry, specificity) for one vocab. Most-specific wins;
    ties broken by first-defined."""
    best = None
    best_spec = -1
    for entry in (_as_dict(vocab).get("interactions") or []):
        if not isinstance(entry, dict):
            continue
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
        # C1: the entry's semantic fields, when authored/auto-filled. {} (an
        # old vocab) is dropped by enrich_events' non-empty filter, so the
        # derived stream only ever carries a semantics dict that says something.
        "vocab_semantics": semantics_from_entry(best_entry),
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
    per_app: dict[str, list[int]] = {}   # process_name -> [total, enriched]
    for ev in events:
        if not isinstance(ev, dict) or ev.get("type") != "interaction":
            continue
        total += 1
        data = _as_dict(ev.get("data"))
        app = data.get("process_name") or "(unknown)"
        counts = per_app.setdefault(app, [0, 0])
        counts[0] += 1
        enrich = lookup(vocabs, data)
        if not enrich:
            # ADR-0024 §6b: no NAMED control match, but the window may still BE a
            # known vocab screen (its window_title_regex). Tag the screen so every
            # interaction on one logical screen shares a value-free screen_id and
            # the screen grain doesn't split into per-window-title nodes. This is
            # NOT a vocab name match, so it does NOT count toward matched/coverage.
            sid = _screen_by_window(vocabs, data)
            if sid and not data.get("screen_id"):
                ev["data"]["screen_id"] = sid
            continue
        ev["data"].update({k: v for k, v in enrich.items() if v is not None and v != {}})
        matched += 1
        counts[1] += 1
        vid = enrich["vocab_source"]["vocab_id"]
        hit[vid] = hit.get(vid, 0) + 1
    # I58: per-app vocabulary coverage -- how much of each app's
    # interaction stream the loaded vocabularies could name.
    coverage = {
        app: {
            "total_interactions": t,
            "enriched": e,
            "coverage_pct": round(100.0 * e / t, 1) if t else 0.0,
        }
        for app, (t, e) in per_app.items()
    }
    summary = {
        "matched": matched,
        "total": total,
        "vocabs_loaded": [
            {"id": v.get("id"), "version": v.get("version", 1)}
            for v in vocabs if isinstance(v, dict)
        ],
        "vocabs_hit": hit,
        "coverage": coverage,
    }
    return events, summary
