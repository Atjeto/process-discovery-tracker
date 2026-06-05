"""Engagement config export / import — PDT-1.0-SPEC §6.5, ADR-0030.

The leave-behind bundle. When a consulting engagement ends and the
client retains PDT, they import this bundle on a fresh install: the
engagement template, calibration thresholds, App Vocabularies the
consultant authored, Reference Maps, PDD templates — everything the
consultant tuned for that client's apps.

Format: a single ZIP at <engagement>/deliverables/engagement-config.zip
containing:

    engagement-config/
      engagement.json              # the engagement metadata (config block)
      vocabularies/                # App Vocabulary YAML files
      reference_maps/              # forked BPMN copies (ADR-0019)
      help_context/                # consultant-authored inline guidance
      manifest.json                # bundle metadata (version, exported_at, source)

stdlib only.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BUNDLE_VERSION = 1


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def export_engagement_config(
    engagement_folder: str | os.PathLike,
    out_path: str | os.PathLike,
    *,
    extra_vocab_dirs: list[str] | None = None,
) -> str:
    """Build the leave-behind config bundle ZIP.

    `engagement_folder` is the source engagement directory (with
    engagement.json + sessions/).
    `out_path` is where to write the .zip (typically
    <engagement>/deliverables/engagement-config.zip).
    `extra_vocab_dirs` is an optional list of vocab YAML source dirs to
    include (the project's `normalization/app_vocabularies/` by default
    when present).
    """
    engagement_folder = Path(engagement_folder)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    engagement_json = engagement_folder / "engagement.json"
    if not engagement_json.exists():
        raise FileNotFoundError(f"engagement.json not found at {engagement_json}")

    # Build the bundle layout in a temp dir, then zip it.
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "engagement-config"
        root.mkdir()

        # 1. engagement.json
        shutil.copy2(engagement_json, root / "engagement.json")

        # 2. Vocabularies
        vocab_dir = root / "vocabularies"
        vocab_dir.mkdir()
        sources = list(extra_vocab_dirs or [])
        # Default: the project app_vocabularies/ directory if present.
        default_vocab = engagement_folder.parent.parent / "normalization" / "app_vocabularies"
        if default_vocab.exists():
            sources.append(str(default_vocab))
        for src in sources:
            sp = Path(src)
            if not sp.exists():
                continue
            for f in sp.rglob("*.yaml"):
                rel = f.relative_to(sp)
                target = vocab_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, target)

        # 3. Reference maps — fork-snapshots living in session folders.
        # Each session under the engagement may have a derived_maps/ subdir.
        ref_dir = root / "reference_maps"
        ref_dir.mkdir()
        sessions_dir = engagement_folder / "sessions"
        if sessions_dir.exists():
            for sess in sessions_dir.iterdir():
                dm = sess / "derived_maps"
                if dm.exists() and dm.is_dir():
                    target = ref_dir / sess.name
                    shutil.copytree(dm, target)

        # 4. Help context placeholder (Phase 5: stubs only).
        help_dir = root / "help_context"
        help_dir.mkdir()
        (help_dir / ".gitkeep").write_text(
            "# Consultant-authored inline help guidance.\n"
            "# Populated when the operate-path UX is fleshed out (PDT-1.0-SPEC §6.5).\n",
            encoding="utf-8",
        )

        # 5. Bundle manifest
        manifest = {
            "version": BUNDLE_VERSION,
            "exported_at": _utc_now_iso(),
            "source_engagement": str(engagement_folder),
            "kind": "engagement-config",
        }
        with open(root / "manifest.json", "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)

        # Zip the bundle.
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for f in root.rglob("*"):
                if f.is_file():
                    z.write(f, f.relative_to(root.parent))

    return str(out_path)


def import_engagement_config(
    bundle_path: str | os.PathLike,
    target_folder: str | os.PathLike,
) -> dict[str, Any]:
    """Import a config bundle ZIP into a fresh PDT install.

    `target_folder` is where the new engagement directory will be
    created (typically `engagements/<name>/`). Returns a dict
    summarising what was imported.
    """
    bundle_path = Path(bundle_path)
    target_folder = Path(target_folder)
    target_folder.mkdir(parents=True, exist_ok=True)

    if not zipfile.is_zipfile(bundle_path):
        raise ValueError(f"{bundle_path} is not a valid ZIP")

    summary = {
        "version": None,
        "engagement": None,
        "vocabularies": 0,
        "reference_maps": 0,
    }

    with zipfile.ZipFile(bundle_path, "r") as z, \
            tempfile.TemporaryDirectory() as td:
        z.extractall(td)
        root = Path(td) / "engagement-config"
        if not root.exists():
            raise ValueError("Bundle missing engagement-config/ root")

        manifest_p = root / "manifest.json"
        if manifest_p.exists():
            with open(manifest_p, "r", encoding="utf-8") as fh:
                summary["version"] = json.load(fh).get("version")

        # engagement.json
        eng_src = root / "engagement.json"
        if eng_src.exists():
            shutil.copy2(eng_src, target_folder / "engagement.json")
            with open(eng_src, "r", encoding="utf-8") as fh:
                summary["engagement"] = json.load(fh).get("engagement_id")

        # Vocabularies
        vocab_src = root / "vocabularies"
        if vocab_src.exists():
            vocab_dst = target_folder / "vocabularies"
            vocab_dst.mkdir(exist_ok=True)
            for f in vocab_src.rglob("*.yaml"):
                rel = f.relative_to(vocab_src)
                tgt = vocab_dst / rel
                tgt.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, tgt)
                summary["vocabularies"] += 1

        # Reference maps
        ref_src = root / "reference_maps"
        if ref_src.exists():
            ref_dst = target_folder / "reference_maps"
            ref_dst.mkdir(exist_ok=True)
            for f in ref_src.rglob("*.bpmn"):
                rel = f.relative_to(ref_src)
                tgt = ref_dst / rel
                tgt.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, tgt)
                summary["reference_maps"] += 1

    return summary
