/*
 * Consent window (§11f). Shown at session start when config.consent.mode is
 * "per_session" or "once" (mirrors the other *-window.js modules but, unlike
 * the fire-and-forget config editors, returns a decision via IPC).
 *
 * showConsentWindow({ text, version }) resolves to { granted: boolean }:
 *   - the worker clicking "I consent" / "Decline" sends pdt:consentDecision,
 *   - closing the window without a choice resolves { granted: false } (a close
 *     is a non-consent -- recording must not start).
 *
 * "once" acknowledgements are remembered in user-config under `_consent` keyed
 * by `<worker>:<version>` so later sessions skip the prompt until the consent
 * text/version changes. The `_consent` key is not part of the YAML config shape
 * and is ignored by everything else.
 *
 * IPC contract:
 *   pdt:consentDecision (renderer -> main)  { granted: boolean }
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, ipcMain } = require("electron");
const { injectTokens } = require("./ui/tokens.js");
const { loadUserConfig, saveUserConfig } = require("./user-config.js");
const { acknowledgementKey } = require("./consent.js");

function buildHtml(opts) {
  const tpl = injectTokens(fs.readFileSync(path.join(__dirname, "ui", "consent.html"), "utf-8"));
  const text = (opts && opts.text) || "";
  // The template carries a single {{CONSENT_TEXT}} slot; escape for HTML.
  const safe = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return tpl.replace("{{CONSENT_TEXT}}", safe);
}

function showConsentWindow(opts) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 560,
      height: 460,
      title: "Recording consent",
      resizable: true,
      autoHideMenuBar: true,
      backgroundColor: "#14141A",
      skipTaskbar: false,
      // Modal-ish: keep it in front so the worker decides before recording.
      alwaysOnTop: true,
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

    let settled = false;
    const wcId = win.webContents.id;

    function onDecision(event, payload) {
      if (event.sender.id !== wcId) return; // ignore other windows
      finish(!!(payload && payload.granted));
    }
    function finish(granted) {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("pdt:consentDecision", onDecision);
      if (!win.isDestroyed()) win.close();
      resolve({ granted });
    }

    ipcMain.on("pdt:consentDecision", onDecision);
    // A close without an explicit decision counts as "do not consent".
    win.on("closed", () => finish(false));

    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(buildHtml(opts)));
    if (opts && opts.parent) win.setParentWindow(opts.parent);
  });
}

/* "once"-mode acknowledgement persistence (user-config `_consent` map). */
function hasAcknowledged(workerId, version) {
  try {
    const uc = loadUserConfig() || {};
    const map = uc._consent || {};
    return !!map[acknowledgementKey(workerId, version)];
  } catch (_) {
    return false;
  }
}

function rememberAcknowledgement(workerId, version, when) {
  try {
    const uc = loadUserConfig() || {};
    const map = Object.assign({}, uc._consent || {});
    map[acknowledgementKey(workerId, version)] = when || new Date().toISOString();
    saveUserConfig({ _consent: map });
  } catch (_) { /* best-effort */ }
}

module.exports = { showConsentWindow, buildHtml, hasAcknowledged, rememberAcknowledgement };
