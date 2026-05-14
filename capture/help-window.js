/*
 * Capture-side help window. Toggled from the tray menu.
 *
 * Same data:-URL + nodeIntegration pattern as status-window.js so we
 * don't ship a separate HTML file. The content is a quick reference
 * for tray actions, hotkeys, OBS setup, config, and troubleshooting.
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildHelpHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>PDT - Help</title>
<style>
  :root { color-scheme: dark;
    --bg: #14131A; --bg-2: #1B1A24; --bg-3: #25232F;
    --fg: #EDE7D3; --fg-2: #C4BBA8; --fg-3: #8A8278;
    --accent: #8BA17A; --accent-2: #6A8CAF; --warn: #D4A24C;
    --rule: #2F2A34; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; line-height: 1.55; }
  body { padding: 20px 26px; overflow-y: auto; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .sub { color: var(--fg-3); font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
    font-family: "IBM Plex Mono", monospace; margin-bottom: 18px; }
  h2 { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--fg-3);
    font-family: "IBM Plex Mono", monospace; margin: 22px 0 10px; }
  p { margin: 6px 0 12px; color: var(--fg-2); }
  ol, ul { margin: 6px 0 14px; padding-left: 22px; }
  li { margin-bottom: 6px; color: var(--fg-2); }
  code { font-family: "IBM Plex Mono", monospace; font-size: 11px;
    background: var(--bg-3); padding: 1px 5px; border-radius: 3px; color: var(--fg); }
  .kbd { display: inline-block; padding: 1px 6px; min-width: 18px; height: 18px;
    font-family: "IBM Plex Mono", monospace; font-size: 10px; line-height: 16px; text-align: center;
    background: var(--bg-3); border: 1px solid var(--rule); border-radius: 3px;
    color: var(--fg); vertical-align: middle; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  td { padding: 6px 10px; border-bottom: 1px solid var(--rule); font-size: 12px; vertical-align: top; }
  td:first-child { width: 170px; }
  .hint { background: var(--bg-2); border-left: 3px solid var(--accent-2);
    padding: 8px 12px; border-radius: 0 4px 4px 0; color: var(--fg-2); font-size: 12px; }
  dl dt { font-weight: 500; color: var(--fg); margin-top: 12px; font-size: 12px; }
  dl dt:first-child { margin-top: 0; }
  dl dd { margin: 4px 0 0; color: var(--fg-2); font-size: 12px; line-height: 1.55; }
  hr { border: none; border-top: 1px solid var(--rule); margin: 20px 0; }
</style></head><body>

<h1>Process Discovery Tracker - Help</h1>
<div class="sub">Capture side · v0.1</div>

<h2>What this app does</h2>
<p>Polls the foreground window every 5 seconds and writes a per-session JSONL of activity, marker, and system events.
Optionally drives OBS to record the screen and writes a clock-sync file so the analyst's viewer can align timeline events with video.</p>

<h2>Running a session</h2>
<ol>
  <li>(Optional) Launch OBS with WebSocket enabled. <em>Tools → WebSocket Server Settings → Enable</em>, port 4455.</li>
  <li>(Optional) Set <code>PDT_CONFIG=path\\to\\your-config.yaml</code> before launch. See <code>sample-config.yaml</code> for the schema.</li>
  <li>Right-click the tray icon → <em>Start capture session</em>. Or just press the start hotkey - the session auto-starts.</li>
  <li>Open the live status window from the tray to see what's being captured.</li>
  <li>Fire markers as the SME walks through processes. Tray → <em>End capture session</em> when done.</li>
</ol>

<h2>Default hotkeys</h2>
<table>
  <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">S</span></td>
      <td>Open the Start-marker label picker. Auto-starts a session if none running.</td></tr>
  <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">E</span></td>
      <td>Fire End marker - closes innermost open.</td></tr>
  <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">P</span></td>
      <td>Manual screenshot - annotated as <code>screenshot_manual</code> in the event stream.</td></tr>
</table>
<p class="hint">All three are overridable in <code>config.yaml</code> under <code>hotkeys:</code>.</p>

<h2>The label picker</h2>
<p>Opened by the Start hotkey or the tray <em>Fire Start marker...</em> action. Type to filter the configured labels, or type a free-form label and press Enter to fire. Use ↑ / ↓ to navigate.</p>

<h2>Tray menu (when a session is running)</h2>
<ul>
  <li><strong>Fire Start marker...</strong> - Spotlight-style picker</li>
  <li><strong>Quick start</strong> - submenu of preconfigured labels (skip the picker)</li>
  <li><strong>Fire End marker</strong> - closes innermost open Start</li>
  <li><strong>Manual screenshot</strong> - capture regardless of trigger config</li>
  <li><strong>Pause / Resume polling</strong></li>
  <li><strong>End capture session</strong> - close out, finalize manifest, stop OBS recording</li>
  <li><strong>Show / Hide status window</strong> - toggle the live dashboard</li>
  <li><strong>Open sessions folder</strong> - jump to <code>%APPDATA%\\process-discovery-tracker\\sessions\\</code></li>
</ul>

<h2>Status window</h2>
<p>Optional live dashboard. Shows:</p>
<ul>
  <li>Recording dot - red pulse while OBS is recording, yellow when paused, grey when idle</li>
  <li>Session timer - wall-clock elapsed since session start</li>
  <li>Current app + title</li>
  <li>Open marker stack with nesting indentation</li>
  <li>Event / marker / screenshot counters</li>
  <li>Last 8 events (live feed)</li>
  <li>Quick actions: Pause/Resume, Manual screenshot, End session</li>
</ul>

<h2>Per-session config</h2>
<p>Optional YAML loaded by setting <code>PDT_CONFIG=path\\to\\config.yaml</code> before launch. Controls process labels, hotkeys, OBS settings, idle thresholds, screenshot triggers, and engagement metadata. See <code>capture/sample-config.yaml</code> in the repo for the full schema with comments.</p>

<h2>OBS integration</h2>
<ul>
  <li>Set <code>obs.required: true</code> in config to fail fast when OBS isn't reachable. Default is <code>false</code> for development.</li>
  <li>First connection auto-creates a scene named per config (default: "Process Discovery -- Default") with a timestamp overlay browser source.</li>
  <li>The recording's start timestamp and tracker↔OBS offset are written to <code>obs/sync.json</code> so the viewer can map any tracker timestamp to a video offset.</li>
</ul>

<h2>Output</h2>
<p>Each session writes a self-contained folder under <code>%APPDATA%\\process-discovery-tracker\\sessions\\&lt;engagement&gt;\\&lt;YYYYMMDD-HHMMSS&gt;\\</code>:</p>
<ul>
  <li><code>events.jsonl</code> - one JSON event per line, append-only, the durable artifact</li>
  <li><code>manifest.json</code> - session metadata, status, OBS reference</li>
  <li><code>config.yaml</code> - snapshot of the config used</li>
  <li><code>screenshots/</code> - event-triggered captures</li>
  <li><code>obs/sync.json</code> - clock-sync data (if OBS was connected)</li>
</ul>

<h2>Troubleshooting</h2>
<dl>
  <dt>Hotkey didn't register</dt>
  <dd>Another app may have the same global shortcut. Enable <code>PDT_DEBUG=1</code> in the launch env and check <code>%APPDATA%\\process-discovery-tracker\\boot.log</code> for <code>hotkeys: start=false</code>. Edit your <code>config.yaml</code> to use different keys.</dd>

  <dt>OBS won't connect</dt>
  <dd>Make sure OBS is running with WebSocket Server enabled (Tools menu). Default port is 4455. If you enabled authentication, set <code>obs.websocket_password</code> in your config. Set <code>obs.required: false</code> to skip OBS entirely.</dd>

  <dt>Tray icon doesn't appear at all</dt>
  <dd>Enable <code>PDT_DEBUG=1</code>, relaunch, and check the boot log. Common causes: another instance already running (single-instance lock), missing tray icon file, antivirus blocking the executable.</dd>

  <dt>Session shows up as "recovered" on next launch</dt>
  <dd>The previous session ended without a clean close (crash, force-quit, power loss). Orphan sessions are auto-marked. Open markers stay in <code>events.jsonl</code> for the normalizer to reconcile per §3.7 of the design.</dd>

  <dt>Where does my data go?</dt>
  <dd><code>%APPDATA%\\process-discovery-tracker\\sessions\\</code> on Windows. The tray has an "Open sessions folder" item.</dd>
</dl>

<hr />
<p style="color: var(--fg-3); font-size: 11px; text-align: center;">Full design doc: <code>process_discovery_tracker_design.md</code> in the repo root.</p>

</body></html>`;
}

function showHelpWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 760,
    title: "PDT - Help",
    autoHideMenuBar: true,
    backgroundColor: "#14131A",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildHelpHtml())
  );
  return win;
}

module.exports = { showHelpWindow };
