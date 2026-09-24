/*
 * flow-view-screenshots.js -- the Flow level's screenshot surfaces:
 * the side-panel thumbnail grid, the full-pane
 * screenshot gallery (arrow-key stepping, auto-advance, near-duplicate
 * folding by aHash), the lazy hover thumbnail, and the guarded
 * open-in-OS-viewer path.
 *
 * Extracted from flow-view.js (god-file split). Self-contained: it owns
 * its own module state (_allScreenshots / _galleryState / the thumb
 * element) and wires the #btn-open-gallery button at require() time.
 * Requires flow-view-video.js for seekToTimestamp (one-way -- video does
 * not depend on this). Consumed by flow-view.js via renderScreenshots
 * (session load) and openScreenshot (the timeline screenshot rail).
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const State = require("../state.js");
const { $, toast, recordingStartMs, sinceStart } = require("../dom.js");
const Ipc = require("../ipc.js");
const { seekToTimestamp } = require("./flow-view-video.js");

/* P2.7 gallery state. _allScreenshots is stashed by renderScreenshots so
   the gallery can step through the same set the grid shows. */
let _allScreenshots = [];
let _galleryState = null;  // { idx, filterReason, playing, playTimer, expanded }

function renderScreenshots() {
  const host = $("#screenshots-grid");
  host.innerHTML = "";
  const shots = (State.getSession().events || []).filter((e) =>
    e.type === "system" &&
    (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
  // Stash for the gallery (P2.7).
  _allScreenshots = shots;
  if (!shots.length) {
    host.innerHTML = '<p class="hint">No screenshots captured in this project.</p>';
    return;
  }
  const origin = recordingStartMs(State.getSession());
  for (const s of shots) {
    const card = document.createElement("div");
    card.className = "thumb";
    const fullPath = path.join(State.getSession().sessionFolder, s.data.path);
    if (fs.existsSync(fullPath)) {
      const img = document.createElement("img");
      img.src = "file:///" + fullPath.replace(/\\/g, "/");
      card.appendChild(img);
    }
    // One clock (AD-26): the time since the recording started, as the
    // timeline, the markers and the step pane show it.
    const stamp = document.createElement("div");
    stamp.className = "stamp";
    stamp.textContent = sinceStart(s.timestamp, origin);
    card.appendChild(stamp);
    if (s.data.kind === "screenshot_manual") {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = "manual";
      card.appendChild(b);
    }
    card.title = "Taken at " + sinceStart(s.timestamp, origin) + "\n" + s.data.path;
    card.addEventListener("click", () => { seekToTimestamp(s.timestamp); openScreenshot(s.data.path); });
    host.appendChild(card);
  }
}

/* P2.7: full-pane screenshot gallery. Step through every screenshot
   with arrow keys, Esc closes, Space toggles auto-advance (~1.2s),
   filter by trigger reason. Built lazily on first open; keeps a
   single overlay element in the DOM after first build. */
function _galleryFilter(reason) {
  // Capture only distinguishes manual screenshots from auto ones today
  // (no reason field on the auto path -- they all come through as
  // kind="screenshot"). Filter accordingly; richer per-trigger
  // distinctions would need a capture-side change to pass `reason`.
  if (!reason || reason === "all") return _allScreenshots.slice();
  return _allScreenshots.filter((s) => {
    const k = s.data.kind || "";
    if (reason === "manual") return k === "screenshot_manual";
    if (reason === "auto")   return k !== "screenshot_manual";
    return true;
  });
}
/* I10: hamming distance between two 16-hex-char aHash strings. A high
   value (mismatched length / missing hash) means "treat as different". */
function _hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
/* I10: the gallery's screenshots collapsed so a run of near-identical
   frames (aHash hamming distance < 5) shows as a single entry -- the
   last frame of the run -- carrying a count of the folded-in frames.
   A group the analyst expanded (clicked the badge) is emitted in full. */
function _galleryView() {
  const list = _galleryFilter(_galleryState.filterReason);
  const hashes = ((State.getSession().stats || {}).screenshot_hashes) || [];
  const byFile = {};
  for (const h of hashes) byFile[h.filename] = h.hash;
  const fileOf = (s) => String(s.data.path || "").split(/[\\/]/).pop();
  const groups = [];
  for (const s of list) {
    const hash = byFile[fileOf(s)] || null;
    const prev = groups[groups.length - 1];
    if (prev && hash && prev.hash && _hammingHex(hash, prev.hash) < 5) {
      prev.shots.push(s);
      prev.hash = hash;
    } else {
      groups.push({ shots: [s], hash });
    }
  }
  const view = [];
  for (const g of groups) {
    const key = fileOf(g.shots[0]);
    if (g.shots.length === 1 || _galleryState.expanded.has(key)) {
      for (const s of g.shots) view.push({ shot: s, similar: 0, groupKey: key });
    } else {
      view.push({
        shot: g.shots[g.shots.length - 1],
        similar: g.shots.length - 1,
        groupKey: key,
      });
    }
  }
  return view;
}
function openScreenshotGallery() {
  if (!_allScreenshots.length) { toast("No screenshots in this project.", ""); return; }
  let overlay = document.getElementById("screenshot-gallery");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "screenshot-gallery";
    overlay.className = "screenshot-gallery";
    overlay.innerHTML =
      '<div class="screenshot-gallery-header">' +
        '<span class="title">Screenshot gallery</span>' +
        '<select id="gallery-filter">' +
          '<option value="all">All screenshots</option>' +
          '<option value="manual">Manual only</option>' +
          '<option value="auto">Auto only</option>' +
        '</select>' +
        '<button id="gallery-play" type="button" class="link-btn">Play (Space)</button>' +
        '<button id="gallery-close" type="button" class="link-btn">Close (Esc)</button>' +
      '</div>' +
      '<div class="screenshot-gallery-body"><img id="gallery-img" alt="screenshot" /></div>' +
      '<div class="screenshot-gallery-footer">' +
        '<span class="pos" id="gallery-pos">-</span>' +
        '<span class="ts" id="gallery-ts">-</span>' +
        '<span class="reason" id="gallery-reason">-</span>' +
        '<span class="flex-spacer" style="flex:1"></span>' +
        '<span style="color:var(--fg-3);font-size:10px">← / → step · Space play · Esc close · click image to seek video</span>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById("gallery-close").addEventListener("click", closeScreenshotGallery);
    document.getElementById("gallery-play").addEventListener("click", _galleryTogglePlay);
    document.getElementById("gallery-filter").addEventListener("change", (e) => {
      _galleryState.filterReason = e.target.value;
      _galleryState.idx = 0;
      _galleryState.expanded = new Set();
      _galleryRenderFrame();
    });
    document.getElementById("gallery-img").addEventListener("click", () => {
      const list = _galleryView();
      const entry = list[_galleryState.idx];
      if (entry) seekToTimestamp(entry.shot.timestamp);
    });
  }
  _galleryState = { idx: 0, filterReason: "all", playing: false, playTimer: null, expanded: new Set() };
  document.getElementById("gallery-filter").value = "all";
  _galleryRenderFrame();
  document.addEventListener("keydown", _galleryKey);
}
function closeScreenshotGallery() {
  const overlay = document.getElementById("screenshot-gallery");
  if (overlay) overlay.style.display = "none";
  if (_galleryState && _galleryState.playTimer) clearTimeout(_galleryState.playTimer);
  document.removeEventListener("keydown", _galleryKey);
  _galleryState = null;
}
function _galleryRenderFrame() {
  const overlay = document.getElementById("screenshot-gallery");
  overlay.style.display = "flex";
  const list = _galleryView();
  if (!list.length) {
    document.getElementById("gallery-img").style.display = "none";
    document.getElementById("gallery-pos").textContent = "0 / 0";
    document.getElementById("gallery-ts").textContent = "";
    document.getElementById("gallery-reason").textContent = "(no matching screenshots)";
    return;
  }
  if (_galleryState.idx >= list.length) _galleryState.idx = list.length - 1;
  if (_galleryState.idx < 0) _galleryState.idx = 0;
  const entry = list[_galleryState.idx];
  const s = entry.shot;
  const fullPath = path.join(State.getSession().sessionFolder, s.data.path);
  const img = document.getElementById("gallery-img");
  img.style.display = "";
  img.src = "file:///" + fullPath.replace(/\\/g, "/");
  document.getElementById("gallery-pos").textContent = `${_galleryState.idx + 1} / ${list.length}`;
  document.getElementById("gallery-ts").textContent = sinceStart(s.timestamp, recordingStartMs(State.getSession()));
  const reasonEl = document.getElementById("gallery-reason");
  reasonEl.textContent =
    s.data.kind === "screenshot_manual" ? "manual" : (s.data.reason || "automatic");
  // I10: this frame stands in for a run of near-identical ones -- offer
  // a click to expand them.
  if (entry.similar > 0) {
    const exp = document.createElement("span");
    exp.className = "gallery-similar";
    exp.textContent = ` (+${entry.similar} near-duplicate${entry.similar === 1 ? "" : "s"}, show)`;
    exp.title = "Show the near-identical frames folded into this one";
    exp.addEventListener("click", () => {
      _galleryState.expanded.add(entry.groupKey);
      _galleryRenderFrame();
    });
    reasonEl.appendChild(exp);
  }
}
function _galleryStep(delta) {
  if (!_galleryState) return;
  const list = _galleryView();
  if (!list.length) return;
  _galleryState.idx = (_galleryState.idx + delta + list.length) % list.length;
  _galleryRenderFrame();
}
function _galleryTogglePlay() {
  if (!_galleryState) return;
  _galleryState.playing = !_galleryState.playing;
  const btn = document.getElementById("gallery-play");
  if (btn) btn.textContent = _galleryState.playing ? "Pause (Space)" : "Play (Space)";
  if (_galleryState.playing) _galleryAdvance();
  else if (_galleryState.playTimer) { clearTimeout(_galleryState.playTimer); _galleryState.playTimer = null; }
}
function _galleryAdvance() {
  if (!_galleryState || !_galleryState.playing) return;
  _galleryState.playTimer = setTimeout(() => {
    _galleryStep(1);
    _galleryAdvance();
  }, 1200);
}
function _galleryKey(e) {
  if (!_galleryState) return;
  if (e.key === "Escape") { e.preventDefault(); closeScreenshotGallery(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); _galleryStep(1); }
  else if (e.key === "ArrowLeft")  { e.preventDefault(); _galleryStep(-1); }
  else if (e.key === " ")          { e.preventDefault(); _galleryTogglePlay(); }
}

/* Open a captured screenshot in the OS image viewer. `relPath` comes
   from untrusted session data (an event's data.path), so this is a
   first line of defense -- the authoritative check is in the main
   process (viewer:openExternal). We require a session-relative image
   path with no absolute root and no `..` traversal, resolve it under the
   session's screenshots/ dir, and confirm the file exists before asking
   main to open it. */
const _IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
function openScreenshot(relPath) {
  const sess = State.getSession();
  if (!relPath || typeof relPath !== "string" || !sess) return;
  if (path.isAbsolute(relPath)) return;
  if (relPath.split(/[\\/]+/).some((s) => s === "..")) return;
  if (!_IMG_EXT_RE.test(relPath)) return;
  const shotsDir = path.resolve(sess.sessionFolder, "screenshots");
  // Screenshot data.path is recorded relative to the session folder
  // (e.g. "screenshots/shot-001.png"); resolve from the session root.
  const full = path.resolve(sess.sessionFolder, relPath);
  const rel = path.relative(shotsDir, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  if (fs.existsSync(full)) Ipc.openExternal(full);
}

// Self-wire the "open gallery" button at require() time (mirrors the
// original IIFE in flow-view.js).
(function wireScreenshotGallery() {
  const btn = document.getElementById("btn-open-gallery");
  if (btn) btn.addEventListener("click", openScreenshotGallery);
})();

module.exports = {
  renderScreenshots, openScreenshot,
};
