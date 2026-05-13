# Viewer

Electron app for the analyst. Two surfaces:

- **Session view** -- one session, video synced to timeline, annotation surface for marker correction and taxonomy promotion (§9.1).
- **Aggregate view** -- N sessions, mined process map, statistics, BPMN export (§9.2).

## Status

Stub. Not implemented in v0.

## Planned scope (iteration 2-3)

- Phase 2 of the build sequence (§11): session view with video-timeline sync, case annotation, taxonomy correction workflow.
- Phase 3: aggregate view with PM4Py-mined process map, statistics panels, BPMN export.

Both phases depend on normalization (Python service) being callable as a subprocess from Electron.

## Install topology

Same packaged Electron .exe pattern as capture (§11.5), plus the python-embeddable normalization runtime shipped alongside as a sibling folder. Analyst double-clicks one .exe -- no Python install, no `pip install`.
