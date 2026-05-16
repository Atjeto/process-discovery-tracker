/*
 * recent.js -- the Recent Sessions list on the Session empty state.
 *
 * Owns the pdt.recentSessions localStorage list, the live-read bundled
 * example sessions, stale-entry auto-cleanup (P1.8), and the rendered
 * list plus its Clear-all / bulk-remove-missing controls. The
 * open-a-session action is injected by renderer.js via initRecent().
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { $, escapeHtml } = require("./dom.js");
const { confirmModal } = require("./modals.js");

const RECENT_KEY = "pdt.recentSessions";
const EXAMPLE_HIDDEN_KEY = "pdt.exampleSessionsHidden";

/* Injected by renderer.js -- opens a session folder into the view. */
let onOpenSession = () => {};

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch (_) { return []; }
}
function setRecent(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
function getHiddenExamples() {
  try { return new Set(JSON.parse(localStorage.getItem(EXAMPLE_HIDDEN_KEY)) || []); }
  catch (_) { return new Set(); }
}
function setHiddenExamples(set) {
  localStorage.setItem(EXAMPLE_HIDDEN_KEY, JSON.stringify(Array.from(set)));
}
function pushRecent(sessionFolder, label) {
  let list = getRecent().filter((r) => r.folder !== sessionFolder);
  list.unshift({ folder: sessionFolder, label, ts: Date.now() });
  list = list.slice(0, 8);
  setRecent(list);
  renderRecent();
}
function removeRecent(folder) {
  /* Examples aren't stored in localStorage -- they're rendered live
     from disk. To "remove" one we mark it hidden so future renders
     skip it. Real recents get pulled from RECENT_KEY as before. */
  const examples = listBundledExamples();
  if (examples.some((e) => e.folder === folder)) {
    const hidden = getHiddenExamples();
    hidden.add(folder);
    setHiddenExamples(hidden);
  } else {
    setRecent(getRecent().filter((r) => r.folder !== folder));
  }
  renderRecent();
}
function clearAllRecent() {
  /* Wipes both the real recents AND the hidden-examples set, so
     anything that was bundled comes back on the next render. */
  setRecent([]);
  localStorage.removeItem(EXAMPLE_HIDDEN_KEY);
  renderRecent();
}

/* Resolve where the bundled example sessions live. In dev the path is
   ../sessions/example-aggregate relative to the renderer's __dirname;
   in a packaged release electron-packager's --extra-resource puts
   them under process.resourcesPath/example-aggregate/. */
function bundledExamplesDir() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "example-aggregate") : null,
    path.resolve(__dirname, "..", "sessions", "example-aggregate"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return null;
}

/* Live-read the example-sessions list every render. Cheap (5 sessions,
   one readdir), and avoids the localStorage-staleness problems of the
   earlier seed-on-first-launch approach -- examples just always
   appear unless the user × them. */
function listBundledExamples() {
  const root = bundledExamplesDir();
  if (!root) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (_) {
    return [];
  }
  return entries.map((d) => ({
    folder: path.join(root, d.name),
    label: "example - " + d.name,
    example: true,
  }));
}

/* Auto-clean grace period (P1.8). Once a recents entry is detected
   missing, we stamp `firstMissingAt`. After STALE_RECENT_DAYS in that
   missing state, the entry is silently dropped on the next render --
   long enough that a one-off network hiccup or unplugged drive doesn't
   prune real recents, but short enough that long-deleted folders don't
   accumulate forever. */
const STALE_RECENT_DAYS = 30;

function renderRecent() {
  const host = $("#recent-list-session");
  if (!host) return;
  const clearBtn = $("#recent-clear-all");
  let recents = getRecent();
  const hidden = getHiddenExamples();
  const examples = listBundledExamples().filter((e) => !hidden.has(e.folder));

  // Auto-clean stale missing entries (P1.8): stamp firstMissingAt on
  // first miss, drop entries that have been missing > STALE_RECENT_DAYS.
  const now = Date.now();
  const staleMs = STALE_RECENT_DAYS * 24 * 60 * 60 * 1000;
  let recentsMutated = false;
  const survivors = [];
  for (const r of recents) {
    let missing = false;
    try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
    if (!missing) {
      // Folder is back -- clear any prior firstMissingAt stamp.
      if (r.firstMissingAt) { delete r.firstMissingAt; recentsMutated = true; }
      survivors.push(r);
      continue;
    }
    if (!r.firstMissingAt) {
      r.firstMissingAt = now;
      recentsMutated = true;
      survivors.push(r);
    } else if (now - r.firstMissingAt > staleMs) {
      // Stale. Drop it silently.
      recentsMutated = true;
      continue;
    } else {
      survivors.push(r);
    }
  }
  if (recentsMutated) {
    recents = survivors;
    setRecent(recents);
  }

  const combined = recents.concat(examples);

  if (!combined.length) {
    host.innerHTML = '<li style="cursor:default;background:transparent;border:none;color:var(--fg-4)">No recent sessions yet.</li>';
    if (clearBtn) clearBtn.style.display = "none";
    return;
  }
  if (clearBtn) clearBtn.style.display = "";

  // Compute live missing-state for the visible list (recents + examples).
  let missingCount = 0;
  const rowData = combined.map((r) => {
    let missing = false;
    try { missing = !fs.existsSync(r.folder); } catch (_) { missing = true; }
    if (missing) missingCount++;
    return { r, missing };
  });

  host.innerHTML = rowData.map(({ r, missing }) => {
    const label = escapeHtml(r.label || path.basename(r.folder));
    const exampleTag = r.example ? '<span class="recent-tag">example</span>' : "";
    const missingTag = missing ? '<span class="recent-missing-tag">missing</span>' : "";
    const cls = missing ? "missing" : "";
    return '<li data-folder="' + escapeHtml(r.folder) + '" class="' + cls + '" title="' + escapeHtml(r.folder) + '">' +
      '<span class="label">' + label + exampleTag + missingTag + '</span>' +
      '<span class="when">' + (r.example || !r.ts ? "" : relTime(r.ts)) + '</span>' +
      '<button class="recent-remove" type="button" title="' + (r.example ? "Hide this example" : "Remove from recents") + '">×</button>' +
    '</li>';
  }).join("");

  // P1.6: batch "Remove N missing" link, alongside Clear all, when ≥2 missing.
  if (clearBtn && missingCount >= 2) {
    let bulk = document.getElementById("recent-bulk-missing");
    if (!bulk) {
      bulk = document.createElement("button");
      bulk.id = "recent-bulk-missing";
      bulk.className = "recent-clear-btn";
      bulk.type = "button";
      bulk.style.marginRight = "6px";
      clearBtn.parentNode.insertBefore(bulk, clearBtn);
      bulk.addEventListener("click", () => {
        const live = getRecent().filter((rr) => {
          try { return fs.existsSync(rr.folder); } catch (_) { return false; }
        });
        setRecent(live);
        renderRecent();
      });
    }
    bulk.textContent = "Remove " + missingCount + " missing";
    bulk.style.display = "";
  } else {
    const bulk = document.getElementById("recent-bulk-missing");
    if (bulk) bulk.style.display = "none";
  }

  host.querySelectorAll("li[data-folder]").forEach((li) => {
    li.addEventListener("click", (e) => {
      if (e.target.closest(".recent-remove")) return;
      onOpenSession(li.dataset.folder);
    });
  });
  host.querySelectorAll(".recent-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRecent(btn.closest("li").dataset.folder);
    });
  });
}
function relTime(ms) {
  const dMs = Date.now() - ms;
  const m = Math.round(dMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

/* Clear-all button lives outside the <ul> so it doesn't get nuked on
   every renderRecent(). Wire once at boot. */
function wireRecentClearAll() {
  const btn = document.getElementById("recent-clear-all");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!getRecent().length) return;
    const ok = await confirmModal({
      title: "Clear recents?",
      message: "Remove all entries from Recents?",
      detail: "Bundled example sessions reappear automatically. Real recents are removed from localStorage; the underlying session folders aren't touched.",
      okLabel: "Clear",
      danger: true,
    });
    if (ok) clearAllRecent();
  });
}

/** Inject the open-session callback and wire boot-time controls. */
function initRecent(opts) {
  onOpenSession = (opts && opts.onOpenSession) || (() => {});
  wireRecentClearAll();
}

module.exports = {
  initRecent, getRecent, getHiddenExamples, listBundledExamples,
  pushRecent, renderRecent, relTime,
};
