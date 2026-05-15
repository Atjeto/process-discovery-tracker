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
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>PDT Help</title>
<style>
  :root {
    color-scheme: dark;
    --bg:       #1a1a1a;
    --bg-2:     #232323;
    --bg-3:     #2c2c2c;
    --border:   #3a3a3a;
    --fg:       #e6e6e6;
    --fg-2:     #a8a8a8;
    --fg-3:     #6e6e6e;
    --accent:   #3a86ff;
    --mono:     ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 13px; line-height: 1.55;
  }
  body { padding: 22px 28px; overflow-y: auto; max-width: 720px; }

  h1 { font-size: 17px; margin: 0 0 4px; font-weight: 600; }
  .sub { color: var(--fg-3); font-size: 12px; margin-bottom: 22px; }
  h2 { font-size: 13px; font-weight: 600; color: var(--fg);
       margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
  p { margin: 6px 0 12px; color: var(--fg-2); }
  ol, ul { margin: 6px 0 14px; padding-left: 22px; }
  li { margin-bottom: 5px; color: var(--fg-2); }

  code { font-family: var(--mono); font-size: 12px;
         background: var(--bg-2); padding: 1px 5px; border-radius: 3px;
         color: var(--fg); border: 1px solid var(--border); }
  .kbd { display: inline-block; padding: 1px 6px; min-width: 18px; height: 18px;
         font-family: var(--mono); font-size: 11px; line-height: 16px; text-align: center;
         background: var(--bg-2); border: 1px solid var(--border); border-radius: 3px;
         color: var(--fg); vertical-align: middle; }

  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  td { padding: 7px 10px; border-bottom: 1px solid var(--border);
       font-size: 12px; color: var(--fg-2); vertical-align: top; }
  td:first-child { width: 180px; }

  .hint { background: var(--bg-2); border-left: 2px solid var(--accent);
          padding: 8px 12px; border-radius: 0 3px 3px 0;
          color: var(--fg-2); font-size: 12px; margin: 8px 0 14px; }

  dl dt { font-weight: 600; color: var(--fg); margin-top: 14px; font-size: 12px; }
  dl dt:first-child { margin-top: 0; }
  dl dd { margin: 4px 0 0; color: var(--fg-2); font-size: 12px; line-height: 1.55; }

  hr { border: none; border-top: 1px solid var(--border); margin: 22px 0; }
  .footer { color: var(--fg-3); font-size: 11px; text-align: center; }
</style></head><body>

<h1>Process Discovery Tracker — Help</h1>
<div class="sub">Capture side · v0.1</div>

<h2>What this app does</h2>
<p>Polls the foreground window every 5 seconds and writes a per-session JSONL of activity, marker, and system events.
Optionally drives OBS to record the screen and writes a clock-sync file so the analyst's viewer can align timeline events with video.</p>

<h2>Running a session</h2>
<ol>
  <li>(Optional) Launch OBS with WebSocket enabled. <em>Tools → WebSocket Server Settings → Enable</em>, port 4455.</li>
  <li>(Optional) Set <code>PDT_CONFIG=path\\to\\your-config.yaml</code> before launch. See <code>sample-config.yaml</code> for the schema.</li>
  <li>Right-click the tray icon → <em>Start capture session</em>. Or just press the start hotkey — the session auto-starts.</li>
  <li>Open the live status window from the tray to see what's being captured.</li>
  <li>Fire markers as the SME walks through processes. Tray → <em>End capture session</em> when done.</li>
</ol>

<h2>Default hotkeys</h2>
<table>
  <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">S</span></td>
      <td>Open the Start-marker label picker. Auto-starts a session if none running.</td></tr>
  <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">E</span></td>
      <td>Fire End marker — closes innermost open.</td></tr>
  <tr><td><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">P</span></td>
      <td>Manual screenshot — annotated as <code>screenshot_manual</code> in the event stream.</td></tr>
</table>
<p class="hint">All three are overridable in <code>config.yaml</code> under <code>hotkeys:</code>.</p>

<h2>The label picker</h2>
<p>Opened by the Start hotkey or the tray <em>Fire Start marker…</em> action. Type a label and press Enter to fire. If <code>process_labels</code> is configured for this engagement, those entries appear as filterable suggestions; otherwise the picker is a free-form input.</p>

<h2>Tray menu (when a session is running)</h2>
<ul>
  <li><strong>Fire Start marker…</strong> — label picker</li>
  <li><strong>Quick start</strong> — submenu of <code>process_labels</code> entries (hidden when none configured)</li>
  <li><strong>Fire End marker</strong> — closes innermost open Start</li>
  <li><strong>Manual screenshot</strong> — capture regardless of trigger config</li>
  <li><strong>Pause / Resume polling</strong></li>
  <li><strong>End capture session</strong> — close out, finalize manifest, stop OBS recording</li>
  <li><strong>Show / Hide status window</strong> — toggle the live dashboard</li>
  <li><strong>Open sessions folder</strong> — jump to <code>%APPDATA%\\process-discovery-tracker\\sessions\\</code></li>
</ul>

<h2>Status window</h2>
<p>Optional live dashboard. Shows:</p>
<ul>
  <li>Recording dot — red while OBS is recording, yellow when paused, grey when idle</li>
  <li>Session timer — wall-clock elapsed since session start</li>
  <li>Current app + title</li>
  <li>Open marker stack with nesting indentation</li>
  <li>Event / marker / screenshot counters</li>
  <li>Last 8 events (live feed)</li>
  <li>Quick actions: Pause/Resume, Manual screenshot, End session</li>
</ul>

<h2>Per-session config</h2>
<p>Optional YAML loaded by setting <code>PDT_CONFIG=path\\to\\config.yaml</code> before launch. Controls process labels, hotkeys, OBS settings, idle thresholds, screenshot triggers, and engagement metadata. See <code>capture/sample-config.yaml</code> in the repo for the full schema with comments.</p>

<h2>OBS recording: first-time setup (5 minutes)</h2>
<p>OBS is optional but recommended. With OBS running, the capture app automatically starts a screen recording when you start a session, stops it when you end, and writes a tiny <code>obs/sync.json</code> file so the analyst's viewer can sync the timeline to the video.</p>
<ol>
  <li><strong>Install OBS Studio</strong> from <code>obsproject.com</code> (version 28 or later). One-time.</li>
  <li><strong>Open OBS</strong> and go to <em>Tools → WebSocket Server Settings</em>.</li>
  <li><strong>Tick "Enable WebSocket server"</strong>. Leave the port at <code>4455</code>. Leave authentication disabled for ease of use on internal machines (or set a password and copy it into your config's <code>obs.websocket_password</code> field). Click OK. OBS doesn't need a restart.</li>
  <li><strong>Leave OBS running</strong> when you start a capture session. The tracker connects automatically, creates a scene named "Process Discovery — Default" the first time, starts recording on session start, and stops on session end.</li>
</ol>
<p>You don't need to click record in OBS yourself. The capture app does it. You also don't need to leave OBS in the foreground — minimize it after step 4 and you'll never need to look at it again unless you want to verify the recording.</p>
<h2>OBS integration details</h2>
<ul>
  <li>Connection: <code>ws://127.0.0.1:4455</code> (localhost only). No network exposure.</li>
  <li>Set <code>obs.required: true</code> in your per-session config to fail fast when OBS isn't reachable. Default is <code>false</code> so capture can run without OBS for ad-hoc testing.</li>
  <li>First connection auto-creates a scene per config (default: "Process Discovery — Default") with a timestamp overlay browser source. The burned-in clock helps you verify sync if anything ever drifts.</li>
  <li>The recording's start timestamp and tracker↔OBS offset are written to <code>obs/sync.json</code> so the viewer can map any tracker event to a video seek position.</li>
  <li>Where the video lands depends on OBS's own <em>Settings → Output → Recording Path</em>. The session's <code>manifest.json</code> records the absolute path so the analyst's viewer can find it after you move the session folder.</li>
</ul>

<h2>Output</h2>
<p>Each session writes a self-contained folder under <code>%APPDATA%\\process-discovery-tracker\\sessions\\&lt;engagement&gt;\\&lt;YYYYMMDD-HHMMSS&gt;\\</code>:</p>
<ul>
  <li><code>events.jsonl</code> — one JSON event per line, append-only, the durable artifact</li>
  <li><code>manifest.json</code> — session metadata, status, OBS reference</li>
  <li><code>config.yaml</code> — snapshot of the config used</li>
  <li><code>screenshots/</code> — event-triggered captures</li>
  <li><code>obs/sync.json</code> — clock-sync data (if OBS was connected)</li>
</ul>

<h2>Operator panel and sync markers</h2>
<p>The <em>Show operator panel</em> tray item opens a larger always-on-top window for the analyst during a walkthrough. Type a marker label, hit Enter — implicitly starts the session and fires the Start marker in one step. Also exposes the sync-marker button.</p>
<p>The <strong>sync marker</strong> (default <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">Y</span>) emits a system event with a shared <code>sync_id</code>. Use it at agreed moments during multi-machine shift reviews so the analyst can correlate timelines across workers later. Without a custom ID, one is auto-generated; pass a known ID when you want two machines to share it (the operator panel prompts for one).</p>

<h2>Citrix and remote desktop notes</h2>
<p>The <code>active-win</code> library that powers polling has known limitations on Citrix: the foreground window is reported as the Citrix client, not the inner app. If your worker runs an app inside Citrix:</p>
<ul>
  <li>Run the capture tracker <em>inside</em> the Citrix session so it polls inner windows. Requires the Citrix profile to permit running unsigned Electron apps.</li>
  <li>If that is not possible, run capture on the local machine; you will get one band labelled <code>Citrix Workspace.exe</code> for the duration. OBS still records the visible content. Use markers and annotations heavily; classification of inner apps must be done by the analyst.</li>
  <li>Validate behavior on a representative machine before scoping a Citrix-heavy engagement.</li>
</ul>

<h2>Storage retention</h2>
<p>Sessions accumulate in <code>%APPDATA%\\process-discovery-tracker\\sessions\\</code> over time. The tray menu now shows the total count and disk usage, and offers two ways to clean up without leaving the app:</p>
<ul>
  <li><strong>Per session:</strong> tray &rarr; Recent sessions &rarr; pick one &rarr; <em>Delete...</em> (confirms, deletes that single folder).</li>
  <li><strong>Bulk by age:</strong> tray &rarr; <em>Prune sessions older than...</em> &rarr; 30 / 90 / 365 days. Lists a sample of what will go, shows total bytes freed, confirms before deleting.</li>
</ul>
<p>The currently-recording session can never be deleted from these menus. For the analyst side (with Python available), <code>scripts/prune-sessions.py --older-than 90 [--apply]</code> still works and supports <code>--keep-recovered</code> to skip orphan-recovered sessions that may need attention.</p>

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

  <dt>BPMN export skipped during normalization</dt>
  <dd>PM4Py's BPMN file writer invokes Graphviz <code>dot</code> for layout. Install Graphviz from graphviz.org and add its bin folder to PATH if you need BPMN files. The DFG view in the viewer renders without Graphviz; only the BPMN file generation requires it.</dd>
</dl>

<hr />
<div class="footer">Full design doc: <code>process_discovery_tracker_design.md</code> in the repo root.</div>

</body></html>`;
}

function showHelpWindow() {
  const win = new BrowserWindow({
    width: 760,
    height: 760,
    title: "PDT Help",
    autoHideMenuBar: true,
    backgroundColor: "#1a1a1a",
    webPreferences: {
      /* Help is static read-only content; we run it under the
         strictest mode: sandboxed renderer with no Node access. */
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(buildHelpHtml())
  );
  return win;
}

module.exports = { showHelpWindow };
