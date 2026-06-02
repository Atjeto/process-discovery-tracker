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

    if args.infile:
        # errors="replace": a genuinely non-UTF-8 byte degrades to U+FFFD rather
        # than raising an uncaught UnicodeDecodeError outside the try below.
        # Mirrors the load_events read-hardening on the file path.
        raw = Path(args.infile).read_text(encoding="utf-8", errors="replace")
    else:
        # Read stdin as UTF-8 EXPLICITLY. Python defaults stdin to the locale/ANSI
        # codepage on Windows (cp1252), which mangles the non-ASCII control names
        # the viewer pipes in as UTF-8 (emoji channel names, the "•" separator) into
        # mojibake like "â€¢". Decode the raw bytes ourselves so it's locale-proof.
        # errors="replace" so a stray non-UTF-8 byte degrades instead of raising
        # an uncaught UnicodeDecodeError (the JSON parse below still reports a
        # bad payload via the {"error":...}/rc=2 contract).
        raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
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
