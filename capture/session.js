"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { zipPathFor } = require("./zip-folder.js");
const { zipsOf } = require("./recording-zip.js");

function pad(n) { return String(n).padStart(2, "0"); }

function sessionTimestampFolder() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function createSession({ baseDir, engagementId, config, consent }) {
  const sessionId = crypto.randomUUID();
  const engagement = engagementId || "default";
  const sessionFolder = path.join(baseDir, engagement, sessionTimestampFolder());
  fs.mkdirSync(sessionFolder, { recursive: true });
  fs.mkdirSync(path.join(sessionFolder, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(sessionFolder, "obs"), { recursive: true });

  const eventsFile = path.join(sessionFolder, "events.jsonl");
  const manifestFile = path.join(sessionFolder, "manifest.json");
  const configFile = path.join(sessionFolder, "config.yaml");

  fs.writeFileSync(eventsFile, "");

  const manifest = {
    session_id: sessionId,
    engagement_id: engagement,
    /* Lift the analyst-entered request name out of the config snapshot to a
       first-class field so the recents list and the viewer header can show it
       without digging into manifest.config. This is the name the operator
       typed in Recording setup (Request name); it was previously saved only
       inside config and never surfaced anywhere (D4). */
    engagement_name: (config && config.engagement_name) || null,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "active",
    /* Every capture is an ordinary business-process recording; the field is
       kept so the manifest shape the viewer reads stays unchanged. */
    purpose: "process",
    config: config || {},
    /* Worker consent record (§11f). Always present so the analyst can see the
       consent posture of every capture; defaults to the not-required shape
       when no consent gate is configured. */
    consent: consent || { required: false, granted: null, mode: "off" },
    obs: { recording_path: null, recording_start_ts: null, offset_ms: null },
    recovered: false,
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  return {
    sessionId,
    sessionFolder,
    eventsFile,
    manifestFile,
    configFile,
    manifest,
  };
}

/* #7 (tech-debt): one atomic read-modify-write for a session manifest.
   `mutate(manifest)` edits the freshly-read object in place; the read, mutate,
   and write happen in a single synchronous pass with NO await between, so two
   concurrent updaters -- e.g. the background OBS `.then()` stamping `m.obs` and
   the display-geometry write adding `m.displays` -- can never each read a stale
   copy and clobber the other's fields (a lost update). A missing file or a
   parse error is a no-op. Returns true when the write happened. Replaces the
   inline read-modify-write that was duplicated across session.js + main.js. */
function updateManifest(sessionFolder, mutate) {
  const manifestFile = path.join(sessionFolder, "manifest.json");
  if (!fs.existsSync(manifestFile)) return false;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
  } catch (_e) {
    return false;   // a torn / hand-corrupted manifest: skip, don't crash
  }
  mutate(manifest);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return true;
}

function closeSession({ sessionFolder, status }) {
  updateManifest(sessionFolder, (manifest) => {
    manifest.ended_at = new Date().toISOString();
    manifest.status = status || "closed";
  });
}

function markSessionRecovered({ sessionFolder }) {
  updateManifest(sessionFolder, (manifest) => {
    manifest.recovered = true;
    manifest.status = "recovered";
    manifest.ended_at = manifest.ended_at || new Date().toISOString();
  });
}

function findOrphanedSessions(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  const orphans = [];
  /* M-20: this runs on the launch path, before the tray exists. An
     unreadable engagement folder (locked, permission-denied, vanished)
     used to throw out of readdir and the app would start with NO tray
     UI. Guard each readdir so one bad folder is skipped (logged), not
     fatal -- mirroring listRecentSessions. */
  let engEntries;
  try { engEntries = fs.readdirSync(baseDir, { withFileTypes: true }); }
  catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`findOrphanedSessions: could not read baseDir ${baseDir}: ${e && e.message}`);
    return orphans;
  }
  for (const ent of engEntries) {
    if (!ent.isDirectory()) continue;
    const engDir = path.join(baseDir, ent.name);
    let subs;
    try { subs = fs.readdirSync(engDir, { withFileTypes: true }); }
    catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`findOrphanedSessions: skipping unreadable engagement folder ${engDir}: ${e && e.message}`);
      continue;
    }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const sFolder = path.join(engDir, s.name);
      const manifestFile = path.join(sFolder, "manifest.json");
      if (!fs.existsSync(manifestFile)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
        if (m.status === "active" && !m.ended_at) {
          orphans.push({ sessionFolder: sFolder, started_at: m.started_at });
        }
      } catch (_) {
        /* skip malformed */
      }
    }
  }
  return orphans;
}

function listRecentSessions(baseDir, limit = 10) {
  if (!fs.existsSync(baseDir)) return [];
  const all = [];
  for (const ent of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const engDir = path.join(baseDir, ent.name);
    let subs;
    try { subs = fs.readdirSync(engDir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      const sFolder = path.join(engDir, s.name);
      const manifestFile = path.join(sFolder, "manifest.json");
      if (!fs.existsSync(manifestFile)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
        /* Display name precedence: an explicit post-session label, then the
           request name the operator entered at setup, then the engagement
           folder. The timestamp folder is always appended so same-named
           sessions stay distinguishable. */
        const engName = m.engagement_name || (m.config && m.config.engagement_name) || null;
        const displayName = (m.label || engName || ent.name || "").trim() || ent.name;
        all.push({
          sessionFolder: sFolder,
          engagement: ent.name,
          engagement_name: engName,
          started_at: m.started_at,
          ended_at: m.ended_at,
          status: m.status,
          label: displayName + "  " + s.name,
        });
      } catch (_) { /* skip malformed */ }
    }
  }
  all.sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
  return all.slice(0, limit);
}

/* B5: snapshot every file in the session folder (name + size) at close.
   The viewer compares this against what actually arrived, so a session
   copied incompletely -- a missing video, a truncated events.jsonl -- is
   caught instead of being silently analyzed. */
function writeSessionIntegrity(sessionFolder) {
  const files = [];
  function walk(dir, prefix) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const ent of entries) {
      const rel = prefix ? prefix + "/" + ent.name : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), rel);
      } else if (rel !== "session-integrity.json") {
        try {
          files.push({ name: rel, size: fs.statSync(path.join(dir, ent.name)).size });
        } catch (_) { /* file vanished mid-walk; skip */ }
      }
    }
  }
  walk(sessionFolder, "");
  files.sort((a, b) => a.name.localeCompare(b.name));
  const integrity = { files, created_at: new Date().toISOString() };
  fs.writeFileSync(
    path.join(sessionFolder, "session-integrity.json"),
    JSON.stringify(integrity, null, 2),
  );
  return integrity;
}

/* B1: stamp an analyst-facing label onto a finished session's manifest,
   set from the post-session summary panel. A blank label clears it.
   Lane LF-SME (live finding 20): the integrity file lists manifest.json at
   its size at Stop, and the name changes that size, so the file is written
   again when there is one: a named recording's list stays true, and the zip
   made next carries it. */
function setSessionLabel(sessionFolder, label) {
  const clean = (label || "").trim();
  updateManifest(sessionFolder, (manifest) => {
    if (clean) manifest.label = clean;
    else delete manifest.label;
  });
  if (fs.existsSync(path.join(sessionFolder, "session-integrity.json"))) {
    writeSessionIntegrity(sessionFolder);
  }
}

/* A recording folder is <baseDir>/<request code>/<timestamp> with a
   manifest.json. The end summary's IPC (show, zip, name) acts only on such
   a folder, never on a path the page could otherwise pass. */
function isRecordingFolder(baseDir, folder) {
  if (typeof folder !== "string" || !folder || typeof baseDir !== "string" || !baseDir) return false;
  const rel = path.relative(path.resolve(baseDir), path.resolve(folder));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (rel.split(/[\\/]/).length !== 2) return false;
  return fs.existsSync(path.join(folder, "manifest.json"));
}

/* Delete a recording: its folder and the zip made for the analyst next to
   it (the end summary's "Make a zip for the analyst"), so no orphan zip is
   left behind. The zip is named after the recording (recording-zip.js):
   the zips holding this folder are found before the folder goes. */
function removeSessionFolder(sessionFolder) {
  const zips = new Set(zipsOf(sessionFolder).concat([zipPathFor(sessionFolder)]));
  fs.rmSync(sessionFolder, { recursive: true, force: true });
  for (const z of zips) fs.rmSync(z, { force: true });
}

module.exports = {
  createSession,
  closeSession,
  markSessionRecovered,
  findOrphanedSessions,
  listRecentSessions,
  writeSessionIntegrity,
  setSessionLabel,
  updateManifest,
  isRecordingFolder,
  removeSessionFolder,
};
