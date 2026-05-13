# Normalization

Python service that turns raw `events.jsonl` from a captured session into a normalized XES + CSV event log (§7 of the design). Runs on the analyst's machine.

## Status

Stub. Not implemented in v0.

## Planned scope (iteration 2)

1. Load `events.jsonl` from a session folder.
2. Sort by timestamp (defensive).
3. Walk marker events, build case tree, assign case IDs (§5.2).
4. Stamp every activity event with its `case_ids` stack.
5. Apply taxonomy classification rules (§7.2).
6. Extract transaction identifiers from window titles.
7. Collapse adjacent identical events.
8. Emit `events.xes` (IEEE 1849-2016) and `events.csv`.

## Install topology

Per §11.5, the planned distribution is a python-embeddable folder shipped alongside the viewer -- no admin install required, no PyPI access at runtime, preloaded with PM4Py and dependencies (numpy, pandas, networkx, graphviz).

The viewer invokes normalization as a subprocess against a session folder. The contract is: in = path to session folder + taxonomy version, out = `events.xes` + `events.csv` written into the same folder.

## When v0 capture lands

You can manually inspect raw `events.jsonl` with `jq` or by piping through `Get-Content -Wait` in PowerShell to see events streaming live. That's the v0 inspection workflow until normalization ships.
