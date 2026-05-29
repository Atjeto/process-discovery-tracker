"""Session-level golden gate (Wave 0 / F2) — pytest wrapper.

Re-normalizes the committed reference session(s) and asserts the output projection
matches the committed golden. This is the whole-session regression gate the unit
suites can't be.

Skips where the pipeline deps (pandas / pm4py) are absent — so it's a no-op on a bare
dev Python but actively gates in CI (`pytest.yml` installs `requirements.txt`) and
under the bundled `viewer/python`. Regenerate goldens after an intended change with:
    <deps-python> normalization/golden_check.py --update
"""
import importlib.util

import pytest

# Skip cleanly unless the pipeline's heavy deps are importable.
_DEPS_OK = all(importlib.util.find_spec(m) is not None for m in ("pandas", "pm4py"))
pytestmark = pytest.mark.skipif(not _DEPS_OK, reason="pipeline deps (pandas/pm4py) not installed")

if _DEPS_OK:
    import golden_check


@pytest.mark.parametrize("session_name", golden_check.REFERENCE_SESSIONS if _DEPS_OK else [])
def test_session_projection_matches_golden(session_name):
    golden = golden_check.load_golden(session_name)
    assert golden is not None, (
        f"no committed golden for {session_name} — run "
        f"`python normalization/golden_check.py --update`"
    )
    actual = golden_check.build_projection(session_name)
    mismatches = golden_check.diff_projection(actual, golden)
    assert not mismatches, (
        f"golden drift in {session_name} ({len(mismatches)} mismatch(es)):\n  "
        + "\n  ".join(mismatches)
        + "\n\nIf this change is intentional, regenerate: "
        "`python normalization/golden_check.py --update`"
    )
