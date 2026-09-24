/*
 * video-path.js: where an attached video is kept (lane V2 item 5; step-back
 * review 4.6, F3). The recording folder is the one hand-off, so the video
 * travels in it: Attach video copies the file into <folder>/video/<name>
 * (unless it is already inside the folder) and annotations.external_video
 * stores its path relative to the folder. Loading resolves a relative path
 * against the folder; an absolute path (an older attach, or a copy that
 * failed) still works, and when it is missing but a file of that name sits
 * in the folder (at its top or in video/), that file is used.
 *
 * Pure: the file checks are passed in (the unit tests use a fake file set).
 */

"use strict";

const path = require("node:path");

/* The last segment of a path written on any machine ("\" or "/"). */
function baseName(p) {
  return String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function _isAbsolute(p) {
  return path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}/.test(p);
}

/* The path of `full` inside `root` (native separators), or null. */
function _inside(root, full) {
  const rel = path.relative(path.resolve(root), full);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : null;
}

/* Where a chosen video is kept: { stored, copyTo }. `stored` is what
   external_video.path holds (relative with "/" when the video is in the
   folder); `copyTo` is the file to copy the video to, or null when no copy
   is needed (the video is inside the folder already, or video/ holds a file
   of the same name and size). fsLike = { exists(p), size(p) }. */
function storePlan(root, videoPath, fsLike) {
  const full = path.resolve(String(videoPath || ""));
  const inside = _inside(root, full);
  if (inside) return { stored: inside.split(path.sep).join("/"), copyTo: null };
  const name = baseName(full);
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  const size = fsLike.size(full);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : stem + " (" + n + ")" + ext;
    const dest = path.join(path.resolve(root), "video", candidate);
    if (!fsLike.exists(dest)) return { stored: "video/" + candidate, copyTo: dest };
    if (size != null && fsLike.size(dest) === size) return { stored: "video/" + candidate, copyTo: null };
  }
  return { stored: full, copyTo: null };
}

/* The video file a stored external_video.path names on this machine, or
   null: a relative path inside the folder; an absolute one that exists;
   else a file of its name at the folder's top or in its video/ folder. */
function resolveStored(root, stored, exists) {
  if (typeof stored !== "string" || !stored.trim()) return null;
  const s = stored.trim();
  if (!_isAbsolute(s)) {
    const full = path.resolve(root, s);
    if (_inside(root, full) && exists(full)) return full;
  } else if (exists(s)) {
    return s;
  }
  const name = baseName(s);
  if (!name) return null;
  for (const cand of [path.join(path.resolve(root), name), path.join(path.resolve(root), "video", name)]) {
    if (exists(cand)) return cand;
  }
  return null;
}

module.exports = { storePlan, resolveStored, baseName };
