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
import sys
from pathlib import Path
from typing import Any

import yaml

import regex_guard
import signature_pick


DEFAULT_DIR = Path(__file__).resolve().parent / "app_vocabularies"


def _warn(msg: str) -> None:
    """Mirror load_canonical's stderr warning style so a bad vocab is visible
    (not silently swallowed) without breaking the normalization run."""
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
# absent means "no semantic"); a vocab carrying them gets three consumers:
#   completion      -> a step-boundary hint in step_suggest (a step ends when
#                      the control completes the unit of work),
#   case_id_source  -> a small scoring bonus in anchor_suggest (never a gate),
#   carries_value   -> widens the rekey detector's field set (facts.rekey_details).
# verb / object / means are authoring-time meaning (discovery autofills verb;
# object/means are human- or LLM-suggested, always analyst-reviewed).

SEMANTIC_FIELDS = (
    "verb", "object", "completion", "case_id_source", "carries_value", "means",
)

# The controlled verb list discovery derives from control_type x event kind.
# An authored vocab may carry any string; this is the AUTO vocabulary.
VERBS = ("enter", "select", "click", "submit", "toggle", "open")

# Name words that mark a control as completing a unit of work (the spec's
# auto-heuristic: Button + save/submit/send/OK). Word-boundary matched so
# "Send" fires but "Sender address" does not... ("OK" however is matched
# case-insensitively as a whole word).
_COMPLETION_NAME_WORDS = frozenset(
    "save submit send ok apply confirm finish done complete post order".split()
)
_COMPLETION_CONTROLS = frozenset({"button", "splitbutton", "hyperlink"})

# control_type -> verb, for controls whose role implies the action.
_VERB_BY_CONTROL = {
    "edit": "enter", "document": "enter", "spinner": "enter",
    "combobox": "select", "list": "select", "listitem": "select",
    "treeitem": "select", "dataitem": "select", "radiobutton": "select",
    "checkbox": "toggle",
    "menuitem": "open", "tabitem": "open", "tab": "open", "hyperlink": "open",
}

# Observed event kind -> verb (the session-bootstrap path, where we saw what
# the worker actually DID with the control; beats the control-role guess).
_VERB_BY_KIND = {
    "value_changed": "enter", "text_changed": "enter",
    "selection_changed": "select", "toggle_changed": "toggle",
}

# Controls that hold a typed/selected business value (the snapshot path's
# carries_value heuristic; the session path uses observed value_changed).
_VALUE_CONTROLS = frozenset(
    {"edit", "document", "combobox", "spinner", "dataitem"})


def _ct(control_type: Any) -> str:
    return str(control_type or "").strip().lower()


def derive_completion(control_type: Any, name: Any) -> bool:
    """Auto-heuristic (spec C1): an action control whose label is a
    completion word ("Save", "Submit incident", "Send", "OK")."""
    if _ct(control_type) not in _COMPLETION_CONTROLS:
        return False
    words = re.findall(r"[a-z]+", str(name or "").lower())
    return any(w in _COMPLETION_NAME_WORDS for w in words)


def derive_verb(control_type: Any, name: Any = None,
                kinds: set[str] | None = None) -> str:
    """control_type x event kind -> verb (spec C1). `kinds` are the observed
    event kinds for this control when bootstrapping from a session; absent
    (snapshot discovery) the control role decides. Completion wins as
    "submit" so a Save/Send button reads as the step-closing act it is."""
    if derive_completion(control_type, name):
        return "submit"
    for k in (kinds or ()):
        v = _VERB_BY_KIND.get(k)
        if v:
            return v
    return _VERB_BY_CONTROL.get(_ct(control_type), "click")


def derive_carries_value(control_type: Any,
                         kinds: set[str] | None = None) -> bool:
    """True when the control carries a business value: observed typing
    (value_changed/text_changed) when we have a session, else the
    control role (an Edit/ComboBox holds a value, a Button doesn't)."""
    if kinds is not None:
        return bool({"value_changed", "text_changed"} & kinds)
    return _ct(control_type) in _VALUE_CONTROLS


def auto_semantics(control_type: Any, name: Any = None,
                   kinds: set[str] | None = None) -> dict[str, Any]:
    """The auto-derivable semantic subset for one control (discovery
    autofill, spec C2). object/means are never guessed -- they are the
    human/LLM half of the record."""
    out: dict[str, Any] = {"verb": derive_verb(control_type, name, kinds)}
    if derive_completion(control_type, name):
        out["completion"] = True
    if derive_carries_value(control_type, kinds):
        out["carries_value"] = True
    return out


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


def _scope_matches(vocab: dict, ev_data: dict) -> bool:
    """An interaction enters a vocab's domain when the vocab's scope
    matches the event. Empty scope matches everything (a "catch-all"
    vocab is legal but probably a mistake)."""
    scope = vocab.get("scope") or {}
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
        if ev.get("type") != "interaction":
            continue
        total += 1
        data = ev.get("data") or {}
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
            {"id": v.get("id"), "version": v.get("version", 1)} for v in vocabs
        ],
        "vocabs_hit": hit,
        "coverage": coverage,
    }
    return events, summary


# --- Bootstrap-from-session authoring -----------------------------------

def _scope_for_app(proc_name: str, datas: list[dict]) -> dict[str, Any]:
    """The scope block for one app: its process_name plus, when the windows
    share a stable common prefix, a window_title_regex narrowing it."""
    scope: dict[str, Any] = {"process_name": proc_name}
    titles = [d.get("window_title") for d in datas if d.get("window_title")]
    title_prefix = _common_prefix(titles) if titles else ""
    if title_prefix and len(title_prefix) >= 3:
        scope["window_title_regex"] = f".*{re.escape(title_prefix.strip())}.*"
    return scope


def _interactions_for_app(datas: list[dict]) -> list[dict[str, Any]]:
    """Dedup one app's interaction-event data dicts into starter vocab rows,
    frequency-ranked. Each row carries the picked signature, a blank `name`
    for the analyst to fill, the auto semantics, `seen_count`, and a `_hint`
    (the raw control label + count). The `_hint` doubles as the discovery
    marker the editor reads to show each row in the review checklist."""
    seen: dict[tuple, dict] = {}
    for d in datas:
        key = _signature_key(d)
        if key is None:
            continue
        entry = seen.get(key)
        if entry:
            entry["_count"] += 1
            if d.get("kind"):
                entry["_kinds"].add(d.get("kind"))
            continue
        sig = _signature_from_event(d)
        if not sig:
            continue
        seen[key] = {
            "signature": sig,
            "_count": 1,
            "_raw_name": d.get("name") or d.get("automation_id") or "",
            "_control_type": d.get("control_type") or "",
            "_kinds": {d.get("kind")} if d.get("kind") else set(),
        }

    # I57: rank interactions by observed frequency (descending) so the
    # analyst names the most-used controls first. `seen_count` is carried
    # as a data field -- the viewer collapses rarely-seen entries under a
    # disclosure -- and echoed in the `_hint` comment for YAML readers.
    interactions = []
    for v in sorted(seen.values(), key=lambda x: -x["_count"]):
        item = {"signature": v["signature"], "name": "", "seen_count": v["_count"]}
        # C2 autofill: verb from control x OBSERVED kinds, carries_value from
        # observed typing, completion from the button-word heuristic -- so the
        # analyst's pass is review, not authoring.
        item.update(auto_semantics(
            v["_control_type"], v["_raw_name"], v["_kinds"] or None))
        # Stash a hint as a YAML comment -- analyst will overwrite name. Always
        # present (even with no raw label) so EVERY bootstrapped row reads as a
        # review-checklist row in the editor (isDiscoveredEntry keys on _hint).
        raw = v["_raw_name"]
        item["_hint"] = (f"raw: {raw!r} (seen {v['_count']}x)" if raw
                         else f"unnamed control (seen {v['_count']}x)")
        interactions.append(item)
    return interactions


def _empty_vocab(vocab_id: str, vocab_name: str) -> dict[str, Any]:
    return {
        "app_vocabulary": {
            "id": vocab_id, "name": vocab_name, "version": 1,
            "scope": {}, "interactions": [],
        }
    }


def _friendly_app_name(proc_name: str) -> str:
    """A display name for an app from its process name: drop the .exe and
    Capitalise a plain lower-case name (`chrome` -> `Chrome`), but leave an
    all-caps acronym alone (`SAPGUI`, `EXCEL`)."""
    base = proc_name[:-4] if proc_name.lower().endswith(".exe") else proc_name
    base = base.strip() or proc_name
    if base.islower():
        return base[:1].upper() + base[1:]
    return base


def bootstrap_from_session(
    events: list[dict[str, Any]],
    *,
    vocab_id: str = "untitled",
    vocab_name: str = "Untitled",
) -> dict[str, Any]:
    """Build a starter vocabulary YAML by deduplicating the unique
    interaction signatures observed in a session.

    Strategy:
      - Group events by (process_name) -- the most stable scope key, and
        emit ONE vocabulary for the most-frequent process. (The per-app
        variant ``bootstrap_per_app_from_session`` emits one per app.)
      - Within a group, dedup events by the most-specific available
        signature: prefer automation_id, then (control_type, name),
        then class_name+name. Carry a count for analyst sizing.
      - Leave `name` field blank with a hint (the raw control name) so
        the analyst fills it in. Don't guess -- we'd just be lying.
    """
    if not events:
        return _empty_vocab(vocab_id, vocab_name)
    by_proc: dict[str, list[dict]] = {}
    for ev in events:
        if ev.get("type") != "interaction":
            continue
        d = ev.get("data") or {}
        pn = d.get("process_name") or "(unknown)"
        by_proc.setdefault(pn, []).append(d)
    if not by_proc:
        return _empty_vocab(vocab_id, vocab_name)

    # Most-frequent process is the assumed app for the vocab.
    dominant_proc = max(by_proc.keys(), key=lambda k: len(by_proc[k]))
    return {
        "app_vocabulary": {
            "id": vocab_id,
            "name": vocab_name,
            "version": 1,
            "scope": _scope_for_app(dominant_proc, by_proc[dominant_proc]),
            "interactions": _interactions_for_app(by_proc[dominant_proc]),
        }
    }


def bootstrap_per_app_from_session(
    events: list[dict[str, Any]],
    *,
    min_interactions: int = 1,
) -> list[dict[str, Any]]:
    """Build ONE starter vocabulary per observed app (G-7).

    The arrival-session workflow: a received recording touches several apps
    the analyst has no vocabulary for. Rather than the dominant-app-only
    ``bootstrap_from_session``, this emits a per-app skeleton -- each scoped
    to its own process_name + window-title pattern, frequency-ranked -- so
    the analyst can start a vocabulary for whichever app they choose, with
    every observed control pre-listed for naming.

    Returns a list of ``{ app, vocab_id, vocab_name, interaction_count,
    app_vocabulary }`` sorted by observed interaction volume (densest first).
    Apps with fewer than ``min_interactions`` distinct named rows are skipped.
    Callers are expected to have already dropped PDT's own surfaces via
    ``process_filter`` (so the tool's own windows never become an "app").
    """
    by_proc: dict[str, list[dict]] = {}
    for ev in events or []:
        if ev.get("type") != "interaction":
            continue
        d = ev.get("data") or {}
        pn = d.get("process_name") or "(unknown)"
        by_proc.setdefault(pn, []).append(d)

    out: list[dict[str, Any]] = []
    for proc_name, datas in by_proc.items():
        interactions = _interactions_for_app(datas)
        if len(interactions) < max(1, min_interactions):
            continue
        name = _friendly_app_name(proc_name)
        out.append({
            "app": proc_name,
            "vocab_id": _slug(name) or _slug(proc_name) or "untitled",
            "vocab_name": name,
            "interaction_count": len(interactions),
            "app_vocabulary": {
                "id": _slug(name) or _slug(proc_name) or "untitled",
                "name": name,
                "version": 1,
                "scope": _scope_for_app(proc_name, datas),
                "interactions": interactions,
            },
        })
    out.sort(key=lambda a: -a["interaction_count"])
    return out


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


# --- Bootstrap-from-snapshot authoring (ADR-0025) -----------------------

def _slug(name: str) -> str:
    """Lowercase + hyphenate -- mirrors the App Library id rule
    (canonical-author.js::slugify / vocab-view.js)."""
    s = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower())
    return s.strip("-")


def _snapshot_sig_key(sig: dict) -> tuple | None:
    """Dedup key for a *picked* signature (no process_name -- a vocab is already
    process/window-scoped). Mirrors canonical-author.js::vocabSignatureKey."""
    aid = sig.get("automation_id")
    if aid:
        return ("aid", aid)
    ct, name, cn = sig.get("control_type"), sig.get("name"), sig.get("class_name")
    if ct and name:
        return ("ctn", ct, name)
    if cn and name:
        return ("cnn", cn, name)
    if name:
        return ("n", name)
    if cn:
        return ("cn", cn)
    return None


# --- Annotator context (ADR-0025 enrichment) --------------------------
#
# Discovery captures more per control than the signature keys on -- the UIA
# role, the framework, the on-screen position, the tree ancestry. The picker
# already computes most of it; bootstrap threads it onto each entry as
# discovery-meta (stripped on save, like identity_source/confidence) so the
# annotator sees WHAT a row is and WHERE it lives before naming it -- closing the
# gap that made a class_name-only row read as a blank "(unset signature)".

_REGION = [
    ["top-left", "top", "top-right"],
    ["left", "center", "right"],
    ["bottom-left", "bottom", "bottom-right"],
]


def _window_frame(controls: list[dict]) -> tuple | None:
    """Bounding box ``(x0, y0, x1, y1)`` over every control that reports bounds --
    the window's on-screen extent, used as the frame for a coarse region. None
    when nothing has bounds."""
    x0 = y0 = x1 = y1 = None
    for c in controls:
        b = c.get("bounds")
        if not isinstance(b, dict):
            continue
        try:
            bx, by, bw, bh = (
                float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"]))
        except (KeyError, TypeError, ValueError):
            continue
        x0 = bx if x0 is None else min(x0, bx)
        y0 = by if y0 is None else min(y0, by)
        x1 = (bx + bw) if x1 is None else max(x1, bx + bw)
        y1 = (by + bh) if y1 is None else max(y1, by + bh)
    return None if x0 is None else (x0, y0, x1, y1)


def _region(bounds: Any, frame: tuple | None) -> str | None:
    """A coarse 3x3 on-screen region ("top-left", "center", "bottom-right") for a
    control's centre relative to the window frame -- a value-free "where" for the
    annotator. None when the control or the frame lacks usable bounds."""
    if not isinstance(bounds, dict) or not frame:
        return None
    try:
        cx = float(bounds["x"]) + float(bounds["w"]) / 2.0
        cy = float(bounds["y"]) + float(bounds["h"]) / 2.0
    except (KeyError, TypeError, ValueError):
        return None
    fx0, fy0, fx1, fy1 = frame
    fw, fh = (fx1 - fx0), (fy1 - fy0)
    if fw <= 0 or fh <= 0:
        return None
    col = min(2, max(0, int((cx - fx0) / fw * 3)))
    row = min(2, max(0, int((cy - fy0) / fh * 3)))
    return _REGION[row][col]


def _member(rep: dict, ancestry: list, frame: tuple | None) -> dict:
    """A compact descriptor of one control collapsed into a merged entry -- its
    distinguishing context (role / region / nearest ancestors / label) so the
    annotator can see what a weak-signature bucket actually contains."""
    m: dict[str, Any] = {}
    if rep.get("role"):
        m["role"] = rep["role"]
    reg = _region(rep.get("bounds"), frame)
    if reg:
        m["region"] = reg
    if ancestry:
        m["under"] = list(ancestry[-3:])
    if rep.get("name"):
        m["name"] = rep["name"]
    return m


def _member_from_item(item: dict) -> dict:
    """Reconstruct the first member's descriptor from a stored entry (it already
    carries role / region / ancestry / name) so the merged-members list can lead
    with the control that seeded the bucket."""
    m: dict[str, Any] = {}
    if item.get("role"):
        m["role"] = item["role"]
    if item.get("region"):
        m["region"] = item["region"]
    if item.get("ancestry"):
        m["under"] = list(item["ancestry"][-3:])
    if item.get("name"):
        m["name"] = item["name"]
    return m


def bootstrap_from_snapshot(
    controls: list[dict[str, Any]],
    *,
    window_title: str | None = None,
    vocab_id: str = "untitled",
    vocab_name: str = "Untitled",
) -> dict[str, Any]:
    """Build a starter vocabulary from a live window snapshot (ADR-0025).

    Where ``bootstrap_from_session`` works off the interacted-only subset of a
    captured session, this works off the **full** control set of a one-shot
    ``snapshot`` (every identifiable control in the window) and uses the
    volatility-diff picker (``signature_pick``) to choose each control's *stable*
    signature -- demoting a per-render automation_id (Salesforce ``input-378``)
    to the accessible label, exactly as the analyst did by hand.

    Differences from the session bootstrap:
      - ``name`` is **pre-filled** from the accessible label (the snapshot has the
        label for every control, not just interacted ones) -- the analyst refines.
      - ``screens`` is grouped by the snapshot's window title (one window -> one
        screen for v1; re-discovery of other windows merges in more).
      - each entry carries the picked ``identity_source`` / ``confidence`` /
        ``volatile_aids`` (so the identity-picker can show *why* a signature was
        chosen) plus the legacy ``_hint`` comment line.
    """
    screen_id: str | None = None
    screens: list[dict[str, Any]] = []
    scope: dict[str, Any] = {}
    if window_title:
        screen_id = _slug(window_title) or "screen"
        screens = [{"id": screen_id, "name": window_title}]
        scope = {"window_title_regex": f".*{re.escape(window_title.strip())}.*"}

    frame = _window_frame(controls)
    seen: dict[tuple, dict] = {}
    interactions: list[dict[str, Any]] = []
    for pick in signature_pick.pick_all(controls):
        sig = pick.get("signature")
        if not sig:
            continue
        rep = pick["group"][0]
        ancestry = pick.get("ancestry") or []
        key = _snapshot_sig_key(sig)
        if key is not None and key in seen:
            prior = seen[key]
            prior["seen_count"] += 1
            # Over-merge transparency: a weak signature (a generic class_name with
            # no label) collapses genuinely DISTINCT controls -- keep each merged
            # member's context (a capped sample) so the annotator can tell, and
            # split a wrong bucket. Only when there's no label to disambiguate by;
            # a shared label is a legitimate single interaction.
            if not prior.get("name"):
                members = prior.setdefault("_members", [_member_from_item(prior)])
                if len(members) < 12:
                    members.append(_member(rep, ancestry, frame))
            continue
        label = rep.get("name") or ""
        item: dict[str, Any] = {
            "signature": sig,
            "name": label,                       # pre-filled from the label
            "identity_source": pick["identity_source"],
            "confidence": pick["confidence"],
            "seen_count": 1,
        }
        # C2 autofill (spec): every discovered row arrives with the auto
        # semantics -- verb from the control role, completion from the
        # button-word heuristic, carries_value from the value-holding roles.
        # No kinds here (a snapshot observed no events); the session
        # bootstrap path refines from observed kinds instead.
        item.update(auto_semantics(
            sig.get("control_type") or rep.get("control_type")
            or rep.get("role"), label))
        # ADR-0025 annotator context (discovery-meta; stripped on save): WHAT the
        # control is + WHERE it lives, so a row is never a contextless signature.
        if rep.get("role"):
            item["role"] = rep["role"]
        if rep.get("framework"):
            item["framework"] = rep["framework"]
        region = _region(rep.get("bounds"), frame)
        if region:
            item["region"] = region
        if ancestry:
            item["ancestry"] = ancestry
        if screen_id:
            item["screen"] = screen_id
        if pick.get("volatile_aids"):
            item["volatile_aids"] = pick["volatile_aids"]
        # Legacy hint comment: raw label + why this signature (identity_source +
        # confidence) + the volatile aids that were rejected, if any.
        hint = []
        if label:
            hint.append(f"label: {label!r}")
        hint.append(f"{pick['identity_source']} (conf {pick['confidence']})")
        if pick.get("volatile_aids"):
            hint.append("rejected volatile aid(s): " + ", ".join(pick["volatile_aids"]))
        item["_hint"] = "; ".join(hint)
        if key is not None:
            seen[key] = item
        interactions.append(item)

    # Most-frequently-seen controls first (matches bootstrap_from_session's I57
    # ranking) so the analyst names the densest controls first.
    interactions.sort(key=lambda x: -x.get("seen_count", 1))

    return {
        "app_vocabulary": {
            "id": vocab_id,
            "name": vocab_name,
            "version": 1,
            "scope": scope,
            "screens": screens,
            "interactions": interactions,
        }
    }


# --- YAML emission -----------------------------------------------------

def to_yaml(doc: dict[str, Any]) -> str:
    """Emit the vocabulary as YAML, lifting `_hint` into a comment
    on the entry it belongs to so the analyst sees the raw signal
    inline without `_hint` polluting the data structure.

    width=inf prevents PyYAML from wrapping long string values across
    multiple lines, which broke the previous line-by-line
    post-processor (continuation lines for a wrapped `_hint:` value
    became orphan content and produced "bad indentation" parse errors
    on reload).
    """
    base = yaml.safe_dump(
        doc, sort_keys=False, allow_unicode=True, width=float("inf"),
    )
    lines = base.splitlines()
    out: list[str] = []
    # Track the index in `out` of the current interaction's
    # `- signature:` line so when we hit its `_hint:` we can insert
    # the comment right above that signature -- attached to the
    # correct entry, not the next one.
    current_sig_idx: int | None = None
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("- signature:"):
            current_sig_idx = len(out)
            out.append(line)
            continue
        if stripped.startswith("_hint:"):
            raw = stripped[len("_hint:"):].strip()
            # Strip YAML quoting layers: outer ' or ", then unescape
            # YAML single-quote doubling ('' -> ').
            if (raw.startswith("'") and raw.endswith("'")) or \
               (raw.startswith('"') and raw.endswith('"')):
                raw = raw[1:-1]
            raw = raw.replace("''", "'")
            if current_sig_idx is not None and raw:
                indent = out[current_sig_idx][: len(out[current_sig_idx]) - len(out[current_sig_idx].lstrip())]
                out.insert(current_sig_idx, f"{indent}# {raw}")
                current_sig_idx += 1  # signature line shifted by 1
            continue
        out.append(line)
    return "\n".join(out) + ("\n" if not base.endswith("\n") else "")
