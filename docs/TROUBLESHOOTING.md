# Troubleshooting

Known failure modes and how to diagnose them. For the design intent, see the [design doc](../../process_discovery_tracker_design.md). For deploy/upgrade questions, see [DEPLOY.md](DEPLOY.md).

## Where to look first

| Symptom surface | Log file |
|---|---|
| Capture app errors (tray, OBS, recorder) | `%APPDATA%\process-discovery-tracker\app.log` |
| Capture app boot issues (set `PDT_DEBUG=1`) | `%APPDATA%\process-discovery-tracker\boot.log` |
| Per-session capture events (always-on once a session exists) | `<session_folder>\capture.log` |
| Normalization warnings / dropped JSONL lines | `<session_folder>\normalize.log` |
| Normalization pipeline status (stdout) | console where you ran `python normalize.py` |

The `dropped_jsonl_lines` field in `stats.json` is the canonical count of malformed events the normalizer dropped. Zero is the expected value.

---

## Capture side

### OBS not connecting at session start

**Symptom:** Session start fails with "OBS not reachable" dialog, or `app.log` shows `OBS connect failed at ws://127.0.0.1:4455`.

**Check:**
1. Is OBS Studio running on the same machine? The tracker only ever connects to localhost.
2. Is OBS WebSocket enabled? Tools menu → WebSocket Server Settings → Enable WebSocket server. Default port 4455.
3. If WebSocket has a password set, did you save it via the tray menu's `Set up OBS recording...`? The password sits in `%APPDATA%\process-discovery-tracker\obs-settings.json`.
4. Firewall / endpoint security: localhost WebSockets usually don't trip corporate AV, but if `app.log` shows a timeout rather than a refused connection, check the host firewall.

The `Set up OBS recording...` dialog has a Test button that runs the same handshake and shows the underlying error string, which is the fastest path to a useful diagnostic.

### Recorder sidecar (`recorder.exe`) won't start

**Symptom:** Capture app starts but the status window shows no UIA interaction events; `app.log` has `recorder.exe not found` or process-spawn errors.

**Check:**
1. Is `recorder.exe` present? See the runtime resolution chain in [BUILD-AND-DIST.md §Runtime resolution](BUILD-AND-DIST.md#runtime-resolution). The fallback auto-extracts a `recorder.zip` if present.
2. Antivirus quarantine: corporate AV occasionally flags freshly-extracted .NET 8 single-file executables on first run. The fix is to whitelist `recorder.exe` by full path (it's ~160 MB, signed if the build did EV signing — see [Security-QA.md §10](Security-QA.md)).
3. `$env:PDT_RECORDER_PATH` set to a path that doesn't exist (dev-only override). Unset it for production.

The recorder uses UI Automation (`UIAutomationCore.dll`) — the same Microsoft accessibility API that Narrator and NVDA use. No `SetWindowsHookEx`, no third-party drivers. If a sec scan flags it, see [Security-QA.md §5](Security-QA.md).

### Hotkeys don't fire markers

**Symptom:** `Ctrl+Shift+S` does nothing, but the tray menu's Start option works.

**Check:**
1. Hotkey collision: another app has the same shortcut registered globally. Common offenders: ShareX, OBS itself, Snip & Sketch. Remap one or the other.
2. Focus: global shortcuts work everywhere; check the tray menu actually says "Start..." (so the app is running and listening) — if the tray icon is missing, the app crashed during startup. Check `boot.log` with `PDT_DEBUG=1`.

### `PDT_CONFIG` not picked up

**Symptom:** Tray menu shows the default label list instead of the engagement's labels.

**Check:**
1. Did you `setx PDT_CONFIG ...` and start a fresh shell? `setx` only affects new processes, not the current one.
2. Does the YAML path exist and parse cleanly? Try `python -c "import yaml; print(yaml.safe_load(open(r'<path>')))"` — a YAML error here means the tracker silently fell back to defaults.

---

## Normalization side

### `events.jsonl not found in <folder>`

The folder you passed isn't a session folder. Confirm it contains `events.jsonl` and `manifest.json` directly (not in a subfolder).

### "Dropped N malformed JSONL line(s)"

**Symptom:** `[normalize] WARNING: dropped N malformed JSONL line(s); see warnings above`.

**Investigate:** Open `normalize.log` in the session folder. Each dropped line is logged with line number, error, and a truncated snippet.

**Likely causes:**
- Tracker crashed mid-write (the line was partially flushed). One or two dropped lines at the tail of a session is benign.
- The file was edited by hand. Don't edit `events.jsonl` — use the analyst's annotation surface in the viewer instead, which writes to `annotations.json` and gets reconciled by `apply_marker_edits()`.
- Disk pressure caused short writes during capture. Rare.

If the dropped count is more than a handful, the session is suspect — discuss with the capture-side worker.

### Taxonomy YAML doesn't parse

Run `python -c "import yaml; yaml.safe_load(open(r'<taxonomy.yaml>'))"` directly to get the parser's line number. Typical issues: tab characters (YAML wants spaces), unquoted strings starting with `*` or `&`, regex backslashes that need `"\\\\"` not `"\\"`.

### PM4Py mining is slow or fails

PM4Py's inductive miner is roughly O(events × variants). Sessions with thousands of events and many trace variants take minutes; sessions with hundreds of thousands of events take hours.

**Mitigations:**
- Filter the input — pass a shorter `--start` / `--end` window if mining a sub-section is acceptable.
- Use DFG instead (`--mine` still emits `dfg.json` even if inductive mining fails). DFG is O(events) and fine for first-pass exploration.
- Bump the noise threshold. `mining_mod.discover_inductive(log, noise_threshold=0.4)` in [mining.py](../normalization/mining.py) drops more low-frequency behavior and produces a smaller, faster model.

### "BPMN mining failed" in normalize output

PM4Py's inductive miner requires traces with at least 2 events. Single-event traces are silently skipped for per-case BPMN (line 399 in [normalize.py](../normalization/normalize.py)). The aggregate BPMN can fail on degenerate inputs — check `normalize.log` for the underlying exception, and consider whether the session has enough activity to mine at all.

### Adonis rejects the BPMN

The PM4Py BPMN output is structurally valid 2.0 XML but uses certain element orderings and namespaces that some Adonis versions trip on. This is a known swap point — see [DEPLOY.md §BPMN export pivot](DEPLOY.md#bpmn-export-pivot-adonis-swap-and-go) for the three escalation tiers.

---

## Viewer side

### "Open session folder..." shows the folder but nothing renders

The folder must contain `manifest.json` and `events.jsonl`. If those are present, check the dev console (View → Toggle Developer Tools) — file-load errors print there. The viewer never modifies the session folder it opens; failing to load is a read-only error.

### "Run normalization" hangs

The viewer spawns the bundled Python via `viewer/python/python.exe`. Slow normalization is the most common cause — see "PM4Py mining is slow" above. Cancel from the UI, or kill the `python.exe` child process from Task Manager (the viewer recovers).

### Process map is empty after mining

Either the session has fewer than 2 events (mining can't produce a meaningful model — see "BPMN mining failed" above), or no taxonomy was provided and every event collapsed into a single `Unclassified — <app>` activity. Provide `--taxonomy` to `normalize` or, in the viewer, use the taxonomy correction panel to promote uncovered events into rules.

### `[REVIEW]` prefixes in exported taxonomy YAML

That's intentional — the viewer's "Promote unclassified to taxonomy" export prefixes each generated label with `[REVIEW]` so it's obvious which entries the analyst must rename before appending to the central taxonomy. Replace `[REVIEW] <appname>` with the real activity label.

---

## Catch-all

If none of the above match, the diagnostic flow is:

1. Check the relevant log file (table at top).
2. Reproduce in isolation — does it happen with a fresh session, or only this one? Does it happen with an empty taxonomy, or only with the team's taxonomy?
3. Capture the exact command, the input session folder shape (paths, file sizes), and the log snippet. That's the package an issue needs to be useful.
