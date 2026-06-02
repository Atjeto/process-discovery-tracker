"""ReDoS guard for AUTHORED regexes run against untrusted strings.

App-vocabulary ``window_title_regex`` and Process-Template ``matches`` /
``window_title_regex`` patterns are authored (analyst-written, or imported from
a shared template) and then matched against UNTRUSTED window titles and field
values captured from third-party apps. A carelessly- or maliciously-authored
pattern with a *nested unbounded quantifier* -- ``(a+)+``, ``(.*)*``,
``(\\d+){2,}`` -- triggers catastrophic backtracking; a 28-character title was
measured taking ~24s.

Python's ``re`` has no per-match timeout, and the deployment target is Windows,
where ``signal.alarm`` does not exist and a worker thread cannot interrupt a
CPU-bound C-level match. So matching cannot be bounded at run time. We instead
reject the dangerous *shape* when the pattern is compiled / loaded. The check
is conservative: it proves nothing about safety, it only refuses the
well-known catastrophic-backtracking construct, so ordinary title regexes
(``.*Incident.*``, ``Create INC\\d+``, ``(foo){2,5}``) pass untouched.

stdlib-only so it runs under the bundled embeddable and a bare test Python.
"""

from __future__ import annotations

import re
from typing import Callable


def _parse_brace(pattern: str, i: int) -> tuple[bool, bool, int]:
    """``pattern[i]`` is ``{``. Return ``(is_quantifier, is_unbounded, end)``
    where ``end`` is the index just past ``}``. A quantifier brace is
    ``{m}`` / ``{m,}`` / ``{m,n}`` / ``{,n}``; it is *unbounded* only when there
    is a comma with nothing after it (``{m,}``). Anything else (``{}``, ``{,}``,
    ``{foo}``, no closing brace) is a literal ``{``."""
    j = pattern.find("}", i)
    if j == -1:
        return (False, False, i + 1)
    inner = pattern[i + 1 : j]
    if inner in ("", ",") or re.fullmatch(r"\d*,?\d*", inner) is None:
        return (False, False, i + 1)
    if "," in inner:
        return (True, inner.split(",", 1)[1] == "", j + 1)
    return (True, False, j + 1)


def _outer_quantifier(pattern: str, i: int) -> tuple[bool, int]:
    """``i`` points just past a ``)``. Return ``(is_unbounded, end)`` for the
    group's quantifier: ``*`` / ``+`` / ``{m,}`` are unbounded, ``?`` / ``{m,n}``
    are bounded, anything else is no quantifier (``end == i``)."""
    if i >= len(pattern):
        return (False, i)
    c = pattern[i]
    if c in "*+":
        return (True, i + 1)
    if c == "?":
        return (False, i + 1)
    if c == "{":
        is_quant, unbounded, end = _parse_brace(pattern, i)
        if is_quant:
            return (unbounded, end)
    return (False, i)


def is_redos_prone(pattern: str) -> bool:
    """True when ``pattern`` contains a nested unbounded quantifier: an
    unbounded-quantified group whose body itself contains an unbounded
    quantifier (the classic catastrophic-backtracking construct). Linear scan;
    never raises -- an invalid pattern just isn't flagged and is left for
    ``re.compile`` to reject."""
    stack: list[bool] = []  # per open group: does its body hold an unbounded quantifier?
    i, n = 0, len(pattern)
    in_class = False
    while i < n:
        c = pattern[i]
        if c == "\\":
            i += 2  # skip the escaped char
            continue
        if in_class:
            if c == "]":
                in_class = False
            i += 1
            continue
        if c == "[":
            in_class = True
            i += 1
            continue
        if c == "(":
            stack.append(False)
            i += 1
            continue
        if c == ")":
            body_unbounded = stack.pop() if stack else False
            outer_unbounded, i = _outer_quantifier(pattern, i + 1)
            if body_unbounded and outer_unbounded:
                return True
            # The group is part of its parent's body: the parent holds an
            # unbounded quantifier if the inner content did, or the group as a
            # whole is unbounded-quantified.
            if stack and (body_unbounded or outer_unbounded):
                stack[-1] = True
            continue
        if c in "*+":
            if stack:
                stack[-1] = True
            i += 1
            continue
        if c == "{":
            is_quant, unbounded, end = _parse_brace(pattern, i)
            if is_quant:
                if unbounded and stack:
                    stack[-1] = True
                i = end
                continue
            i += 1
            continue
        i += 1
    return False


def compile_guarded(
    pattern: str | None,
    flags: int = 0,
    *,
    on_reject: Callable[[str], None] | None = None,
):
    """Compile ``pattern`` unless it is empty, ReDoS-prone, or invalid; return
    the compiled pattern or ``None``. ``on_reject(reason)`` is called (for
    logging) when a non-empty pattern is refused."""
    if not pattern:
        return None
    if is_redos_prone(pattern):
        if on_reject:
            on_reject("rejected ReDoS-prone regex (nested unbounded quantifier)")
        return None
    try:
        return re.compile(pattern, flags)
    except re.error as e:
        if on_reject:
            on_reject(f"invalid regex: {e}")
        return None
