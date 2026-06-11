/*
 * OBS integration via obs-websocket-js v5 (§4).
 *
 * Programmatic scene bootstrap (§6.4 option a). Connects to OBS,
 * verifies / creates the standard scene + timestamp overlay, starts
 * recording, captures the tracker<->OBS clock offset for §4.3 sync.
 *
 * obs-websocket-js ships dual ESM/CJS exports. We use require() instead
 * of dynamic import() because Node's ESM resolver does not find files
 * reliably inside an electron-packager asar archive.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { bootLog } = require("./boot-log.js");

let OBSWebSocketPromise = null;
function getOBSWebSocket() {
  if (!OBSWebSocketPromise) {
    const m = require("obs-websocket-js");
    OBSWebSocketPromise = Promise.resolve(m.default || m.OBSWebSocket || m);
  }
  return OBSWebSocketPromise;
}

/* Burned-in timestamp overlay loaded as a Browser Source via data: URL.
   OBS 28+ CEF accepts data: URLs. Refreshes at 10 Hz per §4.2. */
const TIMESTAMP_OVERLAY_HTML = `<!doctype html><html><head><style>
html,body{margin:0;padding:0;background:transparent;}
body{color:#fff;font-family:'JetBrains Mono','Consolas','Cascadia Code','Courier New',monospace;font-size:32px;font-weight:bold;}
#t{padding:8px 12px;background:rgba(0,0,0,0.55);display:inline-block;border-radius:4px;text-shadow:0 0 4px #000;}
</style></head><body>
<div id="t">--:--:--.---</div>
<script>
function pad(n,w){return String(n).padStart(w||2,"0");}
function tick(){
  var d=new Date();
  var ms=pad(d.getMilliseconds(),3);
  document.getElementById("t").textContent=
    pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds())+"."+ms;
}
setInterval(tick,100);tick();
</script></body></html>`;

function timestampOverlayDataUrl() {
  return (
    "data:text/html;base64," +
    Buffer.from(TIMESTAMP_OVERLAY_HTML).toString("base64")
  );
}

async function connectOBS({ websocketUrl, password }) {
  const OBSWebSocket = await getOBSWebSocket();
  const obs = new OBSWebSocket();
  await obs.connect(websocketUrl, password || undefined);
  return obs;
}

async function ensureScene(obs, sceneName) {
  const { scenes } = await obs.call("GetSceneList");
  const exists = scenes.some((s) => s.sceneName === sceneName);
  if (!exists) {
    await obs.call("CreateScene", { sceneName });
  }
  const inputName = `${sceneName} -- Timestamp`;
  let inputExists = false;
  try {
    const { inputs } = await obs.call("GetInputList");
    inputExists = inputs.some((i) => i.inputName === inputName);
  } catch (_e) { /* older builds */ }
  if (!inputExists) {
    const settings = {
      url: timestampOverlayDataUrl(),
      width: 420,
      height: 60,
    };
    /* OBS uses "browser_source" on most platforms but plain "browser"
       on some Linux builds. Try the modern name first. */
    try {
      await obs.call("CreateInput", {
        sceneName,
        inputName,
        inputKind: "browser_source",
        inputSettings: settings,
      });
    } catch (_e) {
      try {
        await obs.call("CreateInput", {
          sceneName,
          inputName,
          inputKind: "browser",
          inputSettings: settings,
        });
      } catch (_e2) { /* best-effort; scene still works without overlay */ }
    }
  }
  await obs.call("SetCurrentProgramScene", { sceneName });
}

async function startRecording(obs) {
  /* §4.3 -- capture both sides of the clock-sync handshake. */
  const tracker_session_start_ts = new Date().toISOString();
  await obs.call("StartRecord");
  const obs_recording_start_ts = new Date().toISOString();
  /* Wait a beat for OBS to register the output file path. */
  await new Promise((r) => setTimeout(r, 250));
  let recording_path = null;
  try {
    const status = await obs.call("GetRecordStatus");
    recording_path = status.outputPath || status.recordingPath || null;
  } catch (e) {
    /* TD#1b: GetRecordStatus failing used to be swallowed silently, so
       recording_path stayed null and the manifest recorded a video the
       viewer can't locate. Log it loudly. */
    bootLog(`OBS GetRecordStatus failed in startRecording: ${e && e.message}`);
  }
  if (!recording_path) {
    bootLog("OBS startRecording: recording_path could not be determined -- the manifest will reference a recording with no path; the viewer may be unable to locate the video.");
  }
  const offset_ms =
    new Date(obs_recording_start_ts).getTime() -
    new Date(tracker_session_start_ts).getTime();
  return {
    tracker_session_start_ts,
    obs_recording_start_ts,
    offset_ms,
    recording_path,
  };
}

async function stopRecording(obs) {
  let outputPath = null;
  try {
    const status = await obs.call("GetRecordStatus");
    outputPath = status.outputPath || status.recordingPath || null;
  } catch (e) {
    /* TD#1b: don't swallow silently -- this is the last chance to learn
       the recording's path before StopRecord. */
    bootLog(`OBS GetRecordStatus failed in stopRecording: ${e && e.message}`);
  }
  let stopFailed = false;
  try {
    const r = await obs.call("StopRecord");
    if (r && (r.outputPath || r.recordingPath)) {
      outputPath = r.outputPath || r.recordingPath;
    }
  } catch (e) {
    /* TD#1b: a swallowed StopRecord failure can leave OBS recording
       indefinitely with nothing logged. Surface it loudly. */
    stopFailed = true;
    bootLog(`OBS StopRecord FAILED -- OBS may still be recording: ${e && e.message}`);
  }
  if (stopFailed || !outputPath) {
    bootLog(`OBS stopRecording: recording_path could not be determined (stopFailed=${stopFailed}); the viewer may be unable to locate the video.`);
  }
  return { outputPath };
}

function writeSyncFile(obsFolder, sync) {
  fs.mkdirSync(obsFolder, { recursive: true });
  const file = path.join(obsFolder, "sync.json");
  fs.writeFileSync(file, JSON.stringify(sync, null, 2));
  return file;
}

module.exports = {
  connectOBS,
  ensureScene,
  startRecording,
  stopRecording,
  writeSyncFile,
  timestampOverlayDataUrl,
};
