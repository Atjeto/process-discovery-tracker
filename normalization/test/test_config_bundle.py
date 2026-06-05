"""Engagement config bundle tests — PDT-1.0-SPEC §6.5."""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_NORM = _HERE.parent
if str(_NORM.parent) not in sys.path:
    sys.path.insert(0, str(_NORM.parent))

from normalization.engagement import new_engagement, write_engagement  # noqa: E402
from normalization.engagement.config_bundle import (  # noqa: E402
    export_engagement_config,
    import_engagement_config,
    BUNDLE_VERSION,
)


def _seed_engagement(folder: Path) -> None:
    eng = new_engagement(name="Test engagement", client="Test client")
    write_engagement(folder, eng)


def test_export_creates_valid_zip(tmp_path):
    eng_dir = tmp_path / "engagement"
    eng_dir.mkdir()
    _seed_engagement(eng_dir)
    out = export_engagement_config(eng_dir, tmp_path / "bundle.zip")
    assert Path(out).exists()
    assert zipfile.is_zipfile(out)
    with zipfile.ZipFile(out, "r") as z:
        names = z.namelist()
        assert any(n.endswith("engagement-config/engagement.json") for n in names)
        assert any(n.endswith("engagement-config/manifest.json") for n in names)


def test_round_trip_preserves_engagement(tmp_path):
    eng_dir = tmp_path / "src"
    eng_dir.mkdir()
    _seed_engagement(eng_dir)
    bundle = export_engagement_config(eng_dir, tmp_path / "bundle.zip")

    dst = tmp_path / "dst"
    summary = import_engagement_config(bundle, dst)
    assert summary["version"] == BUNDLE_VERSION
    assert summary["engagement"] is not None
    imported = json.loads((dst / "engagement.json").read_text(encoding="utf-8"))
    assert imported["name"] == "Test engagement"


def test_export_includes_extra_vocab_dir(tmp_path):
    eng_dir = tmp_path / "engagement"
    eng_dir.mkdir()
    _seed_engagement(eng_dir)
    vocab_dir = tmp_path / "vocabs"
    vocab_dir.mkdir()
    (vocab_dir / "test.yaml").write_text("app_vocabulary:\n  process_name: test.exe\n")

    out = export_engagement_config(eng_dir, tmp_path / "bundle.zip",
                                   extra_vocab_dirs=[str(vocab_dir)])
    with zipfile.ZipFile(out, "r") as z:
        names = z.namelist()
        assert any(n.endswith("vocabularies/test.yaml") for n in names)


def test_import_handles_extra_files(tmp_path):
    eng_dir = tmp_path / "engagement"
    eng_dir.mkdir()
    _seed_engagement(eng_dir)
    # Add a reference_map for one synthetic session
    sess = eng_dir / "sessions" / "s1"
    sess.mkdir(parents=True)
    dm = sess / "derived_maps"
    dm.mkdir()
    (dm / "rm-abc.bpmn").write_text("<bpmn:definitions></bpmn:definitions>")

    bundle = export_engagement_config(eng_dir, tmp_path / "bundle.zip")
    dst = tmp_path / "dst"
    summary = import_engagement_config(bundle, dst)
    assert summary["reference_maps"] == 1
    assert (dst / "reference_maps" / "s1" / "rm-abc.bpmn").exists()


def test_import_invalid_zip_raises(tmp_path):
    bad = tmp_path / "not_a_zip.zip"
    bad.write_text("not really a zip")
    try:
        import_engagement_config(bad, tmp_path / "dst")
        assert False, "expected ValueError"
    except ValueError:
        pass
