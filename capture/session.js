"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function pad(n) { return String(n).padStart(2, "0"); }

function sessionTimestampFolder() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function createSession({ baseDir, engagementId, config, purpose, prepApp }) {
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
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "active",
    /* purpose:
       - undefined / "process": ordinary business process capture (default)
       - "app_prep":            curating an App Vocabulary; prep_app names the target
    */
    purpose: purpose || "process",
    prep_app: prepApp || null,
    config: config || {},
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

function closeSession({ sessionFolder, status }) {
  const manifestFile = path.join(sessionFolder, "manifest.json");
  if (!fs.existsSync(manifestFile)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
  manifest.ended_at = new Date().toISOString();
  manifest.status = status || "closed";
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}

function markSessionRecovered({ sessionFolder }) {
  const manifestFile = path.join(sessionFolder, "manifest.json");
  if (!fs.existsSync(manifestFile)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
  manifest.recovered = true;
  manifest.status = "recovered";
  manifest.ended_at = manifest.ended_at || new Date().toISOString();
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}

function findOrphanedSessions(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  const orphans = [];
  for (const ent of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const engDir = path.join(baseDir, ent.name);
    for (const s of fs.readdirSync(engDir, { withFileTypes: true })) {
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
        all.push({
          sessionFolder: sFolder,
          engagement: ent.name,
          started_at: m.started_at,
          ended_at: m.ended_at,
          status: m.status,
          label: ent.name + "  " + s.name,
        });
      } catch (_) { /* skip malformed */ }
    }
  }
  all.sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
  return all.slice(0, limit);
}

module.exports = {
  createSession,
  closeSession,
  markSessionRecovered,
  findOrphanedSessions,
  listRecentSessions,
};
