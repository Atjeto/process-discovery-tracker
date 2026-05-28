"use strict";

/*
 * Persistent per-user overlay for the capture config.
 *
 * Stored at `<userData>/user-config.json` and deep-merged ON TOP of the
 * YAML config (PDT_CONFIG or quick-config.yaml) at launch -- so the YAML
 * provides defaults / engagement-level shape and the UI-edited "Profile"
 * and "Settings" windows own everything they expose.
 *
 * The file holds a partial config object (same shape as the YAML), so a
 * merge is just deepMerge into the loaded config. Only the slices the
 * UI edits ever land here -- worker (Profile), hotkeys/obs/screenshots/
 * storage limits (Settings).
 *
 * One-time migration: the older `obs-settings.json` (which carried the
 * OBS url + password as a separate file) is folded into the obs slice on
 * first load if no user-config exists yet. The legacy file is left in
 * place as a safety net -- nothing reads it once the overlay exists.
 *
 * Tests do not import this module (it requires electron's `app`).
 * config.js stays electron-free.
 */

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { deepMerge } = require("./config.js");

const FILE = "user-config.json";
const LEGACY_OBS_FILE = "obs-settings.json";

function userConfigPath() {
  return path.join(app.getPath("userData"), FILE);
}

function readJsonOrEmpty(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const txt = fs.readFileSync(p, "utf-8");
    if (!txt.trim()) return null;
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

function migrateLegacyObsSettings() {
  /* Fold `<userData>/obs-settings.json` { url, password } into
     { obs: { websocket_url, websocket_password } } so the new overlay
     owns OBS connection details going forward. Returns the partial
     object to seed the user-config with (or null if nothing to do). */
  const legacy = readJsonOrEmpty(path.join(app.getPath("userData"), LEGACY_OBS_FILE));
  if (!legacy || (!legacy.url && !legacy.password)) return null;
  const obs = {};
  if (legacy.url) obs.websocket_url = legacy.url;
  if (legacy.password) obs.websocket_password = legacy.password;
  return { obs };
}

let _cache = null;

function loadUserConfig() {
  if (_cache) return _cache;
  let stored = readJsonOrEmpty(userConfigPath());
  if (!stored) {
    /* First launch under the new persistence scheme: seed from the
       legacy obs-settings.json if it exists, so a returning user keeps
       their OBS connection details without re-entering them. */
    const seeded = migrateLegacyObsSettings();
    if (seeded) {
      try { writeFile(seeded); } catch (_) { /* best-effort */ }
      stored = seeded;
    } else {
      stored = {};
    }
  }
  _cache = stored;
  return stored;
}

function writeFile(obj) {
  const p = userConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

/* Deep-merge `partial` into the stored overlay, write it back, and
   return the merged object. Callers should also update their in-memory
   `config` with the same partial so changes apply without a restart
   (where the setting is read live -- screenshots / obs / storage). */
function saveUserConfig(partial) {
  const current = loadUserConfig() || {};
  const merged = deepMerge(current, partial || {});
  writeFile(merged);
  _cache = merged;
  return merged;
}

/* Test seam + a way to force a re-read after an external edit. */
function _resetCache() { _cache = null; }

module.exports = { userConfigPath, loadUserConfig, saveUserConfig, _resetCache };
