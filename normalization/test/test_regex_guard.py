"""Tests for regex_guard -- the ReDoS lint over authored regexes.

Authored vocab/template regexes run against untrusted window titles. A nested
unbounded quantifier ((a+)+ etc.) is rejected at load time because Python's re
cannot be bounded at run time on Windows.
"""

from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from regex_guard import is_redos_prone, compile_guarded


DANGEROUS = [
    "(a+)+",
    "(a*)*",
    "(.+)+",
    "(.*)*",
    r"(\d+){2,}",
    "(a+)*",
    "([a-z]+)+",
    "(ab+)+c",
    "((a+))+",       # inner quantifier, outer-group quantified
    "(a{2,})+",      # brace-form inner unbounded
    "prefix(x+)+suffix",
]

SAFE = [
    ".*Incident.*",
    r"Create INC\d+",
    "a+",
    "a*",
    "(abc)+",
    "(a|b)+",
    "[a-z]+",
    r"\d{1,5}",
    "(foo){2,5}",
    "a{2,}",         # single unbounded, no nesting
    r"(\d+)",        # group with unbounded body but NOT outer-quantified
    "(abc)?",        # optional group, bounded
    r"Book\d+ - Excel",
    "",
]


def test_dangerous_patterns_are_flagged():
    for p in DANGEROUS:
        assert is_redos_prone(p), f"should flag {p!r}"


def test_safe_patterns_are_not_flagged():
    for p in SAFE:
        assert not is_redos_prone(p), f"should NOT flag {p!r}"


def test_compile_guarded_rejects_dangerous_returns_none():
    reasons = []
    r = compile_guarded("(a+)+", on_reject=reasons.append)
    assert r is None
    assert reasons and "ReDoS" in reasons[0]


def test_compile_guarded_compiles_safe():
    r = compile_guarded(r"Create INC\d+")
    assert r is not None and r.search("Create INC0010010 | ServiceNow")


def test_compile_guarded_rejects_invalid_regex():
    reasons = []
    assert compile_guarded("(unclosed", on_reject=reasons.append) is None
    assert reasons and "invalid" in reasons[0]


def test_compile_guarded_none_and_empty():
    assert compile_guarded(None) is None
    assert compile_guarded("") is None


def test_linter_itself_is_fast_on_the_classic_payload():
    # The lint must be cheap even on the pattern it exists to catch.
    t0 = time.perf_counter()
    for _ in range(1000):
        is_redos_prone("(a+)+(b+)+(c+)+x")
    assert time.perf_counter() - t0 < 1.0


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
            print("ok", _name)
    print("all passed")
