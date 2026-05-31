"""Discover-from-window CLI (ADR-0025).

The analyst-side half of in-app vocabulary discovery: read a window snapshot
(the controls the recorder's ``snapshot`` command emitted, plus the window
title), run the volatility-diff picker + ``bootstrap_from_snapshot``, and print
the App-Vocabulary skeleton as JSON for the viewer to load into the App Library
editor.

The viewer spawns this with the bundled Python the same way it spawns
``normalize.py`` (``python-runner.js``). Input is a JSON document on a file path
(``--in``) or stdin:

    { "controls": [ <snapshot_control.data>, ... ],
      "window_title": "Book1 - Excel",
      "vocab_id": "excel", "vocab_name": "Microsoft Excel" }

Output (stdout, single JSON object): the ``{ "app_vocabulary": { ... } }`` doc.
Pure-Python (no pandas / pm4py) so it runs on the bundled embeddable.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app_vocab  # noqa: E402


def discover(payload: dict) -> dict:
    controls = payload.get("controls") or []
    return app_vocab.bootstrap_from_snapshot(
        controls,
        window_title=payload.get("window_title"),
        vocab_id=payload.get("vocab_id") or "untitled",
        vocab_name=payload.get("vocab_name") or "Untitled",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ADR-0025 discover-from-window")
    ap.add_argument("--in", dest="infile", default=None,
                    help="JSON input file; reads stdin when omitted")
    args = ap.parse_args(argv)

    raw = (Path(args.infile).read_text(encoding="utf-8")
           if args.infile else sys.stdin.read())
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"bad input JSON: {e}"}))
        return 2

    doc = discover(payload)
    # The viewer parses the trailing JSON block of stdout (python-runner.js).
    print(json.dumps(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
