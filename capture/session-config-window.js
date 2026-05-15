/*
 * Session config window. Form for editing the per-session YAML that the
 * tracker loads at startup -- engagement metadata, worker identity,
 * label list for the tray menu, idle threshold, OBS scene.
 *
 * Save target: `<userData>/quick-config.yaml`. The next launch picks
 * this up automatically if PDT_CONFIG is unset (see main.js startup).
 * Editing takes effect on restart; the current session keeps its
 * loaded config.
 *
 * IPC contract:
 *   pdt:sessionConfigGet   -> { yaml: string, path: string|null }
 *   pdt:sessionConfigSave  -> { saved: boolean, path: string, error?: string }
 */

"use strict";

const { BrowserWindow } = require("electron");

function buildHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Session config</title>
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
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 13px; line-height: 1.5;
  }
  body { padding: 18px 22px; display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .sub { color: var(--fg-3); font-size: 12px; }
  fieldset { border: 1px solid var(--border); border-radius: 5px; padding: 10px 12px 12px; margin: 0; }
  legend { font-size: 11px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 1.5px; padding: 0 6px; }
  label { display: block; font-size: 11px; color: var(--fg-3); margin-bottom: 4px; margin-top: 8px; }
  label:first-child { margin-top: 0; }
  input[type=text], input[type=number], textarea {
    width: 100%; padding: 7px 9px;
    background: var(--bg-2); border: 1px solid var(--border);
    color: var(--fg); border-radius: 3px;
    font-family: inherit; font-size: 12px; outline: none;
  }
  textarea { min-height: 90px; resize: vertical; font-family: ui-monospace, Consolas, monospace; }
  input:focus, textarea:focus { border-color: var(--accent); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .help-hint { font-size: 11px; color: var(--fg-3); margin-top: 6px; }
  .status { padding: 8px 10px; border-radius: 4px; font-size: 12px;
    background: var(--bg-2); border-left: 3px solid var(--fg-3); min-height: 32px; }
  .status.good { border-color: var(--good); color: #c8e6c9; }
  .status.bad  { border-color: var(--bad);  color: #ffcdd2; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  button { padding: 8px 16px; background: var(--bg-3); color: var(--fg);
    border: 1px solid var(--border); border-radius: 3px;
    font-family: inherit; font-size: 12px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { filter: brightness(1.1); }
</style></head><body>

<div>
  <h1>Session config</h1>
  <div class="sub">Authored here, saved as <code>quick-config.yaml</code>, loaded on the next tracker launch.</div>
</div>

<fieldset>
  <legend>Engagement</legend>
  <div class="row2">
    <div>
      <label for="eng-id">Engagement ID</label>
      <input type="text" id="eng-id" placeholder="ENG-2026-001" />
    </div>
    <div>
      <label for="eng-name">Display name</label>
      <input type="text" id="eng-name" placeholder="Customer onboarding review" />
    </div>
  </div>
</fieldset>

<fieldset>
  <legend>Worker</legend>
  <div class="row2">
    <div>
      <label for="worker-id">Worker ID</label>
      <input type="text" id="worker-id" placeholder="auto-detected from USERNAME if blank" />
    </div>
    <div>
      <label for="worker-role">Role (optional)</label>
      <input type="text" id="worker-role" placeholder="CSR, Analyst, ..." />
    </div>
  </div>
</fieldset>

<fieldset>
  <legend>Process labels (one per line)</legend>
  <textarea id="labels" placeholder="Order entry\nRefund flow\nIdentity check"></textarea>
  <div class="help-hint">These appear in the tray menu's Start picker. Comments after <code>#</code> are stripped.</div>
</fieldset>

<fieldset>
  <legend>Behaviour</legend>
  <div class="row2">
    <div>
      <label for="idle">Auto-end idle threshold (minutes)</label>
      <input type="number" id="idle" min="1" max="240" step="1" placeholder="30" />
    </div>
    <div>
      <label for="obs-scene">OBS scene name</label>
      <input type="text" id="obs-scene" placeholder="Process Discovery -- Default" />
    </div>
  </div>
</fieldset>

<div class="status" id="status">Edit the fields above, click Save.</div>

<div class="actions">
  <button id="btn-cancel">Cancel</button>
  <button id="btn-save" class="primary">Save</button>
</div>

<script>
const { ipcRenderer } = require("electron");
const yaml = require("js-yaml");
const $ = (s) => document.getElementById(s);

async function load() {
  const cur = await ipcRenderer.invoke("pdt:sessionConfigGet");
  let parsed = {};
  try { parsed = yaml.load(cur.yaml || "") || {}; }
  catch (_) { parsed = {}; }
  $("eng-id").value      = parsed.engagement_id   || "";
  $("eng-name").value    = parsed.engagement_name || "";
  $("worker-id").value   = (parsed.worker && parsed.worker.id) || "";
  $("worker-role").value = (parsed.worker && parsed.worker.role) || "";
  $("idle").value        = parsed.auto_end_idle_minutes || 30;
  $("obs-scene").value   = (parsed.obs && parsed.obs.scene_name) || "";
  const labels = Array.isArray(parsed.process_labels)
    ? parsed.process_labels.join("\\n") : "";
  $("labels").value = labels;
}
load();

function buildYaml() {
  const labels = $("labels").value.split("\\n")
    .map((s) => s.replace(/#.*$/, "").trim())
    .filter(Boolean);
  const idle = parseInt($("idle").value, 10);
  const obj = {
    engagement_id:        $("eng-id").value.trim()   || undefined,
    engagement_name:      $("eng-name").value.trim() || undefined,
    worker: {
      id:   $("worker-id").value.trim()   || undefined,
      role: $("worker-role").value.trim() || undefined,
    },
    auto_end_idle_minutes: Number.isFinite(idle) ? idle : undefined,
    process_labels:        labels.length ? labels : undefined,
    obs: $("obs-scene").value.trim()
      ? { scene_name: $("obs-scene").value.trim() }
      : undefined,
  };
  /* Trim undefined fields so the YAML doesn't carry nulls everywhere */
  function prune(o) {
    if (o === null || typeof o !== "object") return o;
    if (Array.isArray(o)) return o.map(prune);
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const pv = prune(v);
      if (pv === undefined) continue;
      if (pv && typeof pv === "object" && !Array.isArray(pv) && Object.keys(pv).length === 0) continue;
      out[k] = pv;
    }
    return out;
  }
  return yaml.dump(prune(obj), { lineWidth: 100 });
}

$("btn-save").addEventListener("click", async () => {
  const status = $("status");
  status.className = "status";
  status.textContent = "Saving...";
  const text = buildYaml();
  const r = await ipcRenderer.invoke("pdt:sessionConfigSave", { yaml: text });
  if (r && r.saved) {
    status.className = "status good";
    status.innerHTML = "<strong>Saved to</strong> " + escapeHtml(r.path) +
      ".<br>Restart the tracker to load the new config.";
  } else {
    status.className = "status bad";
    status.textContent = "Failed: " + ((r && r.error) || "unknown");
  }
});
$("btn-cancel").addEventListener("click", () => window.close());

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
</script></body></html>`;
}

function showSessionConfigWindow(opts) {
  const win = new BrowserWindow({
    width: 580,
    height: 640,
    title: "Session config",
    resizable: true,
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
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml()));
  if (opts && opts.parent) win.setParentWindow(opts.parent);
  return win;
}

module.exports = { showSessionConfigWindow };
