# Normalization

The analyst-side Python pipeline. It turns a session folder into runs,
drafted steps, statistics and the analysis, writes the step-level process
map (`--mine`) and renders the PDD (`--pdd-out`) and the Technical details
workbook (`--tech-out`). The viewer runs it with
its bundled Python, by itself when a session opens without a current
analysis; it also runs from a shell.

Architecture, stages and modules:
[docs/architecture/NORMALIZATION.md](../docs/architecture/NORMALIZATION.md).
File formats: [shared/SCHEMA.md](../shared/SCHEMA.md).

## Install

Python 3.10 or later. From this folder:

```
pip install -r requirements.txt
```

The released viewer ships its own Python with these packages
(`viewer/python/`), so the analyst's machine needs no install.

## Usage

Analyze a session the way the viewer does (from the repo root):

```
python normalization/normalize.py <session_folder> --taxonomy normalization/taxonomy.yaml --mine --names "<viewer userData>/pdt-library/remembered-names.json"
```

| Flag | Effect |
|---|---|
| `--taxonomy` | The classification rules. The activity statistics use them; drafting does not. |
| `--mine` | Also write `process_map_step.bpmn`, the step-level map. |
| `--names` | The remembered-names store: a draft whose `draft_key` it lists takes the remembered name, after the names the session's own steps give. |
| `--pdd-out` | Render the PDD to this `.docx` path. |
| `--pdd-map-image`, `--pdd-tobe-image` | Pictures of the As-Is and To-Be maps for the PDD. |
| `--pdd-map-images` | A manifest of the maps' pictures for the PDD, the main map's and one per sub-process (`{"maps": [{"path": [...], "png": "..."}]}`). |
| `--tech-out` | Write the Technical details workbook (`.xlsx`) to this path. |
| `--handoff` | The hand-off version the PDD and the workbook are made for ("Version N, handed off ..."); without it they are a working copy. |

Outputs land in the session folder: `stats.json`, `analysis.json`, the
updated `annotations.json`, `process_map_step.bpmn` (with `--mine`) and
`normalize.log`. `events.jsonl` is never changed, so re-running is always
safe; the analyst's steps survive it.

Exit codes: 0 success; 1 a usage error, a folder that is not a session
folder, or a crash; 2 `annotations.json` cannot be read (nothing written);
3 a requested export failed, and nothing in the project was changed (a run
moves its outputs into place only as its last act, once it succeeded).

Import a Teams meeting transcript (separate entry point):

```
python normalization/transcript_import.py <session_folder> <transcript.vtt|.docx>
```

## Tests

`python -m pytest normalization/test/` on a Python without pandas and pm4py
skips the pipeline tests and still looks green. Run the full-deps recipe in
[CONTRIBUTING.md](../CONTRIBUTING.md) instead. The session golden
(`golden_check.py`, see [golden/README.md](golden/README.md)) re-analyzes the
committed demo sessions and compares the result with `golden/`.
