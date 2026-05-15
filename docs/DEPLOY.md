# Deployment

How to get Process Discovery Tracker onto a fresh worker or analyst machine, and how upgrades and rollbacks work in practice. For build mechanics (how zips are produced), see [BUILD-AND-DIST.md](BUILD-AND-DIST.md).

## Capture (worker machine)

Prereqs: OBS Studio 28+ with WebSocket enabled (the team standard). No admin rights, no installer, no PATH changes.

1. Download `capture-vX.Y.Z.zip` from the [Releases page](../../../releases).
2. Unzip wherever the worker prefers — `C:\Users\<user>\PDT\capture\` is the usual place.
3. (First time only) Set `PDT_CONFIG` to the engagement YAML path so the tray picks up labels, idle threshold, OBS scene. Either:
   - User env var: `setx PDT_CONFIG "C:\Users\<user>\PDT\config\engagement.yaml"` (takes effect on next shell)
   - Or launch via a shortcut whose `Start in` field sets the env var
4. Run `Process Discovery Tracker.exe`. Tray icon appears. Verify OBS reachability via the tray menu's `Set up OBS recording...` test button.

Sessions land under `%APPDATA%\process-discovery-tracker\sessions\<engagement>\<timestamp>\`. The capture app never writes to its install folder, so the install is read-only at runtime.

## Viewer (analyst machine)

No prereqs. Python is bundled in the zip via Python embeddable — no host Python install required, no `pip install`.

1. Download `viewer-vX.Y.Z.zip` from the [Releases page](../../../releases).
2. Unzip wherever. Common: `C:\Users\<user>\PDT\viewer\`.
3. Run `Process Discovery Viewer.exe`. Use `Open session folder...` to load a session pulled from a worker machine.

The viewer never modifies the session folder it opens — normalization writes new files (`events.xes`, `events.csv`, `stats.json`, `process_map.bpmn`, etc.) alongside `events.jsonl`, but `events.jsonl` itself is immutable. Re-running normalization is always safe.

## Upgrades

The install is a folder. Upgrading is replacing that folder.

1. Quit the running app (tray exit for capture, close window for viewer).
2. Rename the existing folder to `<name>.old`. (Faster than deleting; lets you roll back instantly.)
3. Unzip the new release in place.
4. Restart.

**What survives an upgrade:**

| State | Location | Notes |
|---|---|---|
| Captured sessions | `%APPDATA%\process-discovery-tracker\sessions\` | Outside the install dir — untouched. |
| Per-machine OBS settings | `%APPDATA%\process-discovery-tracker\obs-settings.json` | Untouched. |
| Engagement config YAML | Wherever `PDT_CONFIG` points | Owned by the analyst, not the install. |
| Boot log / app log | `%APPDATA%\process-discovery-tracker\` (`boot.log`, `app.log`) | Untouched; append-only. |

**What does NOT survive:** the bundled Python embeddable, the recorder sidecar, the central taxonomy that ships with the build. Anything inside the unzipped folder is replaced. If the analyst customized the shipped taxonomy in-place (don't), changes are lost — track engagement-specific taxonomies separately.

## Rollback

The previous install is sitting next to the new one as `<name>.old`. Quit the running app, delete or move the new folder, rename `<name>.old` back. No data migration is involved because none of the runtime state lives inside the install.

If `<name>.old` is gone, re-download the prior `capture-vX.Y.Z.zip` / `viewer-vX.Y.Z.zip` from the [Releases page](../../../releases) and unzip. Sessions remain compatible across releases — `events.jsonl` schema is versioned in `manifest.json`.

## BPMN export pivot (Adonis swap-and-go)

The default BPMN exporter goes through PM4Py's `discover_bpmn_inductive`. The output is BPMN 2.0 XML, intended to import cleanly into Adonis. **Adonis compatibility is not load-bearing.** If a future Adonis version rejects PM4Py's BPMN structure, the export path is the swap point — not the design.

Swap options, in order of effort:

1. **Tweak the existing BPMN serializer.** [mining.py](../normalization/mining.py) `export_bpmn` wraps PM4Py's writer; namespace tweaks or attribute filtering often resolve Adonis quirks without changing the upstream model.
2. **Add a post-processor.** Write an XSLT or Python pass that runs after `export_bpmn` and rewrites whatever Adonis dislikes. Plug into [normalize.py](../normalization/normalize.py) immediately after the existing `mining_mod.export_bpmn(...)` call.
3. **Switch the export format.** If BPMN itself isn't the right shape, emit Adonis-native XML or fall back to image+CSV. The viewer's `process_map.bpmn` is one of many session artifacts; downstream consumers can switch to another file without affecting capture, normalization, or mining.

In all three cases, `events.xes` and `events.csv` are unchanged — they're the durable analyst-side artifacts. BPMN is a derived view.

## Multi-machine setup

For an IE shift review across N machines, each worker machine gets the capture zip and a shared `engagement.yaml` (typically on a network share or pasted into each machine). Sessions from each worker are gathered on the analyst machine via copy/paste or a shared folder. There is no central coordinator service — the session package is the only integration seam (§2.1 of the design doc).

## Troubleshooting

If something goes wrong during deploy or upgrade, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
