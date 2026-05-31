"""ADR registry guard (CI-gated; runs in pytest.yml).

Prevents the ADR-number collisions that bit us when concurrent chips picked numbers
from prose instead of a checked source of truth (e.g. 0019 got reused). Enforces that
`docs/adr/README.md` is the canonical registry and that every ADR file agrees with it.

Pure file I/O — no pipeline deps, so it runs everywhere. If this fails, fix the
registry (`docs/adr/README.md`) or your ADR filename; do NOT delete the test.
"""
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
ADR_DIR = REPO / "docs" / "adr"
REGISTRY = ADR_DIR / "README.md"

_FILE_RE = re.compile(r"^(\d{4})-.+\.md$")
# A registry row: | 0019 | Title | Status |
_ROW_RE = re.compile(r"^\|\s*(\d{4})\s*\|(.*)\|(.*)\|\s*$")


def _adr_files() -> dict[int, str]:
    out: dict[int, list[str]] = {}
    for p in ADR_DIR.glob("[0-9]*.md"):
        m = _FILE_RE.match(p.name)
        if m:
            out.setdefault(int(m.group(1)), []).append(p.name)
    return out  # type: ignore[return-value]


def _registry_rows() -> dict[int, str]:
    """number -> the row's status cell text (lowercased)."""
    rows: dict[int, str] = {}
    for line in REGISTRY.read_text(encoding="utf-8").splitlines():
        m = _ROW_RE.match(line)
        if m:
            rows[int(m.group(1))] = m.group(3).strip().lower()
    return rows


def _is_gap(status: str) -> bool:
    return "gap" in status or "reserved" in status


def test_registry_exists():
    assert REGISTRY.exists(), f"ADR registry missing: {REGISTRY} (it is the source of truth)"


def test_no_duplicate_adr_numbers():
    files: dict[int, list[str]] = {}
    for p in ADR_DIR.glob("[0-9]*.md"):
        m = _FILE_RE.match(p.name)
        if m:
            files.setdefault(int(m.group(1)), []).append(p.name)
    dups = {n: names for n, names in files.items() if len(names) > 1}
    assert not dups, f"Duplicate ADR number(s): {dups}. Each number is used once; take max+1."


def test_every_adr_file_is_registered():
    rows = _registry_rows()
    missing = sorted(n for n in _adr_files() if n not in rows)
    assert not missing, (
        f"ADR file(s) not in docs/adr/README.md: {['%04d' % n for n in missing]}. "
        "Add a registry row in the same commit as the ADR."
    )


def test_no_file_reuses_a_dead_gap():
    rows = _registry_rows()
    reused = sorted(n for n in _adr_files() if n in rows and _is_gap(rows[n]))
    assert not reused, (
        f"ADR file(s) reuse a number the registry marks a dead gap: "
        f"{['%04d' % n for n in reused]}. Gaps are never reused — take max+1."
    )


def test_every_non_gap_registry_row_has_a_file():
    rows = _registry_rows()
    files = _adr_files()
    missing = sorted(n for n, status in rows.items() if not _is_gap(status) and n not in files)
    assert not missing, (
        f"Registry lists ADR(s) with no file: {['%04d' % n for n in missing]}. "
        "Either add the file or mark the row a gap."
    )


def test_registry_documents_the_max_plus_one_rule():
    text = REGISTRY.read_text(encoding="utf-8").lower()
    assert "max(existing) + 1" in text or "max+1" in text, (
        "The registry must state the 'next number = max+1, never reuse a gap' rule."
    )
