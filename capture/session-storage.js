"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { dialog } = require("electron");
const { bootLog } = require("./boot-log.js");
const { listRecentSessions } = require("./session.js");

/* Recursive byte total for a folder. Unreadable entries are skipped. */
function folderBytes(folder) {
  let total = 0;
  let stack = [folder];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      } catch (_) { /* unreadable file -- skip */ }
    }
  }
  return total;
}

function humanSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + " " + units[i];
}

/*
 * Session storage: disk-usage accounting and the delete / prune flows.
 *
 * The base directory, the active-session guard, and the tray refresh
 * all live in the main process and change over a session's life, so
 * they are injected:
 *   getBaseDir()             -> the sessions root, or null before ready
 *   getActiveSessionFolder() -> the recording session's folder, or null
 *   refreshTray()            -> redraw the tray after a delete
 */
function createSessionStorage({ getBaseDir, getActiveSessionFolder, refreshTray }) {
  /* The tray menu rebuilds on every 5s status tick, so the sessions
     total is cached for a minute and invalidated after any delete. */
  let cache = null;
  let cacheUntil = 0;

  function folderSizeHuman(folder) {
    return humanSize(folderBytes(folder));
  }

  function getSessionsTotal() {
    const now = Date.now();
    if (cache && now < cacheUntil) return cache;
    let count = 0;
    let bytes = 0;
    const baseDir = getBaseDir();
    if (baseDir && fs.existsSync(baseDir)) {
      for (const eng of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (!eng.isDirectory()) continue;
        const engDir = path.join(baseDir, eng.name);
        let subs;
        try { subs = fs.readdirSync(engDir, { withFileTypes: true }); }
        catch (_) { continue; }
        for (const s of subs) {
          if (!s.isDirectory()) continue;
          const sFolder = path.join(engDir, s.name);
          if (!fs.existsSync(path.join(sFolder, "manifest.json"))) continue;
          count++;
          bytes += folderBytes(sFolder);
        }
      }
    }
    cache = { count, bytes };
    cacheUntil = now + 60_000;
    return cache;
  }

  function invalidateSessionsCache() {
    cache = null;
    cacheUntil = 0;
  }

  async function confirmAndDeleteSession(sessionFolder, label) {
    /* Never delete the currently active session. */
    if (getActiveSessionFolder() === sessionFolder) {
      await dialog.showMessageBox({
        type: "info",
        title: "Cannot delete",
        message: "This session is currently being recorded. End it first via the tray menu.",
        buttons: ["OK"],
      });
      return;
    }
    const bytes = folderBytes(sessionFolder);
    const r = await dialog.showMessageBox({
      type: "warning",
      title: "Delete session?",
      message: "Delete this session folder?",
      detail: `${label || sessionFolder}\n${sessionFolder}\n\nFrees ${humanSize(bytes)}. This cannot be undone.`,
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    try {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
      invalidateSessionsCache();
      refreshTray();
      bootLog(`deleted session ${sessionFolder} (${bytes} bytes)`);
    } catch (e) {
      dialog.showErrorBox("Delete failed", `${e && e.message}\n\nThe folder may still exist; check Explorer.`);
    }
  }

  async function confirmAndPruneByAge(days) {
    const baseDir = getBaseDir();
    if (!baseDir || !fs.existsSync(baseDir)) return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const candidates = [];
    let totalBytes = 0;
    const activeFolder = getActiveSessionFolder();
    for (const r of listRecentSessions(baseDir, Number.MAX_SAFE_INTEGER)) {
      if (activeFolder && r.sessionFolder === activeFolder) continue;  // never the active one
      const startMs = r.started_at ? new Date(r.started_at).getTime() : 0;
      if (!startMs || startMs >= cutoff) continue;
      const b = folderBytes(r.sessionFolder);
      candidates.push({ ...r, bytes: b });
      totalBytes += b;
    }
    if (!candidates.length) {
      await dialog.showMessageBox({
        type: "info",
        title: "Nothing to prune",
        message: `No sessions older than ${days} days.`,
        buttons: ["OK"],
      });
      return;
    }
    const sample = candidates.slice(0, 8).map(c => `  ${c.label}  (${humanSize(c.bytes)})`).join("\n");
    const more = candidates.length > 8 ? `\n  ...and ${candidates.length - 8} more` : "";
    const r = await dialog.showMessageBox({
      type: "warning",
      title: "Prune old sessions?",
      message: `Delete ${candidates.length} session${candidates.length === 1 ? "" : "s"} older than ${days} days?`,
      detail: `Frees ${humanSize(totalBytes)} total. This cannot be undone.\n\n${sample}${more}`,
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    let deleted = 0;
    let failed = 0;
    for (const c of candidates) {
      try {
        fs.rmSync(c.sessionFolder, { recursive: true, force: true });
        deleted++;
      } catch (e) {
        failed++;
        bootLog(`prune failed for ${c.sessionFolder}: ${e && e.message}`);
      }
    }
    invalidateSessionsCache();
    refreshTray();
    await dialog.showMessageBox({
      type: failed ? "warning" : "info",
      title: "Prune complete",
      message: failed
        ? `Deleted ${deleted}, ${failed} failed (see boot.log if PDT_DEBUG=1).`
        : `Deleted ${deleted} session${deleted === 1 ? "" : "s"}.`,
      buttons: ["OK"],
    });
  }

  return {
    folderBytes,
    humanSize,
    folderSizeHuman,
    getSessionsTotal,
    invalidateSessionsCache,
    confirmAndDeleteSession,
    confirmAndPruneByAge,
  };
}

module.exports = { createSessionStorage, folderBytes, humanSize };
