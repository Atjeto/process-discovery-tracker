/*
 * OBS settings window. Small modal where the user can paste their
 * OBS WebSocket password and test the connection.
 *
 * Same data: URL + nodeIntegration pattern as the label picker, so we
 * don't ship a separate HTML file. Renderer talks back via IPC:
 *   pdt:obsTest    -> { ok, message }
 *   pdt:obsSave    -> { saved: true }
 *   pdt:obsGet     -> { url, password }
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildSettingsHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>OBS Settings</title>
<style>
  :root {
    color-scheme: dark;
    --bg:       #1a1a1a;
    --bg-2:     #232323;
    --bg-3:     #2c2c2c;
    --bg-hover: #363636;
    --border:   #3a3a3a;
    --fg:       #e6e6e6;
    --fg-2:     #a8a8a8;
    --fg-3:     #6e6e6e;
    --accent:   #3a86ff;
    --good:     #4caf50;
    --bad:      #c83434;
    --mono:     ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 13px; line-height: 1.5;
  }
  body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .sub { color: var(--fg-3); font-size: 12px; margin-top: 2px; }

  fieldset { border: 1px solid var(--border); border-radius: 5px;
    padding: 12px 14px 14px; margin: 0; }
  legend { font-size: 11px; color: var(--fg-3); text-transform: uppercase;
    letter-spacing: 1.5px; padding: 0 6px; }
  label { display: block; font-size: 11px; color: var(--fg-3);
    margin-bottom: 6px; }
  input[type=text], input[type=password] {
    width: 100%; padding: 8px 10px;
    background: var(--bg-2); border: 1px solid var(--border);
    color: var(--fg); border-radius: 3px;
    font-family: inherit; font-size: 12px; outline: none;
  }
  input[type=text]:focus, input[type=password]:focus { border-color: var(--accent); }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  .row label { flex: 1; margin: 0; }
  .help-hint { font-size: 11px; color: var(--fg-3); margin-top: 6px; line-height: 1.5; }
  .help-hint code { background: var(--bg-2); padding: 1px 5px; border-radius: 3px;
    font-family: var(--mono); font-size: 10px; color: var(--fg-2); }

  .status { padding: 10px 12px; border-radius: 4px;
    font-size: 12px; line-height: 1.5; min-height: 38px;
    background: var(--bg-2); border-left: 3px solid var(--fg-3); }
  .status.good { border-color: var(--good); color: #c8e6c9; }
  .status.bad  { border-color: var(--bad);  color: #ffcdd2; }

  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  .actions .left { margin-right: auto; }
  button { padding: 8px 16px; background: var(--bg-3); color: var(--fg);
    border: 1px solid var(--border); border-radius: 3px;
    font-family: inherit; font-size: 12px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--accent); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover:not(:disabled) { filter: brightness(1.1); }

  .pw-row { position: relative; }
  .pw-toggle {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    background: transparent; border: 0; color: var(--fg-3); cursor: pointer;
    padding: 2px 6px; font-size: 11px;
  }
  .pw-toggle:hover { color: var(--accent); }
</style></head><body>

<div>
  <h1>OBS recording settings</h1>
  <div class="sub">Connection details for the OBS WebSocket server.</div>
</div>

<fieldset>
  <legend>Connection</legend>
  <label for="url">Server URL</label>
  <input type="text" id="url" placeholder="ws://127.0.0.1:4455" />
  <div class="row">
    <label class="pw-row">
      Server password (leave blank if OBS auth is disabled)
      <input type="password" id="pw" placeholder="paste here from OBS" autocomplete="off" />
      <button type="button" class="pw-toggle" id="pw-toggle">show</button>
    </label>
  </div>
  <div class="help-hint">
    In OBS: <code>Tools → WebSocket Server Settings → Show Connect Info</code> reveals the password.
    To skip auth entirely, untick <code>Enable Authentication</code> in OBS, click Apply, and leave the
    password field here blank.
  </div>
</fieldset>

<div class="status" id="status">Click <strong>Test connection</strong> to verify OBS is reachable.</div>

<div class="actions">
  <button id="btn-test" class="left">Test connection</button>
  <button id="btn-cancel">Cancel</button>
  <button id="btn-save" class="primary">Save</button>
</div>

<script>
const { ipcRenderer } = require("electron");
const $ = (s) => document.getElementById(s);

async function load() {
  const cur = await ipcRenderer.invoke("pdt:obsGet");
  $("url").value = cur.url || "ws://127.0.0.1:4455";
  $("pw").value  = cur.password || "";
}
load();

$("pw-toggle").addEventListener("click", () => {
  const pw = $("pw");
  if (pw.type === "password") { pw.type = "text"; $("pw-toggle").textContent = "hide"; }
  else { pw.type = "password"; $("pw-toggle").textContent = "show"; }
});

async function test() {
  $("btn-test").disabled = true;
  const status = $("status");
  status.className = "status";
  status.textContent = "Testing...";
  const r = await ipcRenderer.invoke("pdt:obsTest", {
    url: $("url").value.trim(),
    password: $("pw").value,
  });
  $("btn-test").disabled = false;
  status.className = "status " + (r.ok ? "good" : "bad");
  status.innerHTML = (r.ok ? "<strong>Connected.</strong> " : "<strong>Failed.</strong> ") + escapeHtml(r.message || "");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
$("btn-test").addEventListener("click", test);

$("btn-save").addEventListener("click", async () => {
  await ipcRenderer.invoke("pdt:obsSave", {
    url: $("url").value.trim(),
    password: $("pw").value,
  });
  window.close();
});
$("btn-cancel").addEventListener("click", () => window.close());

// Auto-test once at open if URL pre-filled
setTimeout(test, 200);
</script></body></html>`;
}

function showObsSettingsWindow(opts) {
  const win = new BrowserWindow({
    width: 540,
    height: 460,
    title: "OBS Settings",
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#1a1a1a",
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildSettingsHtml()));
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showObsSettingsWindow };
