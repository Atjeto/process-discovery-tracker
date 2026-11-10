/*
 * new-project.js: a session folder made without a recording (contract C16),
 * main process only. "New project from a video..." makes one around a video
 * (copied into its video/ folder, the path stored relative to the folder,
 * offset 0); "New empty project..." makes an empty one. Each gets manifest.json
 * (session_id, source, started_at, label: the name the analyst gave), an
 * empty events.jsonl and annotations.json. The analysis then gives it one
 * implicit run (the pipeline's half of C16).
 *
 * Lane B4b: the video project takes several videos and their transcripts in
 * one pick (or one drop on the page shown while no project is open): the
 * videos back to back in the order of their names (chainOf), and each
 * transcript with its video (matchTranscripts; main.js imports them once
 * the folder is made).
 */

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");
const VideoPath = require("./video-path.js");

/* Why a new project cannot go into `folder`, or null: it may not exist yet,
   or exist empty. */
function folderProblem(folder, fs = nodeFs) {
  if (!fs.existsSync(folder)) return null;
  let st;
  try { st = fs.statSync(folder); } catch (e) { return "it cannot be read (" + e.message + ")"; }
  if (!st.isDirectory()) return "a file of that name is there";
  return fs.readdirSync(folder).length ? "a folder of that name is there and it is not empty" : null;
}

/* When a video starts, as the contract's default: the file's creation time,
   else its modified time, else `now` (ISO strings). */
function startedAtOf(stat, now) {
  for (const d of [stat && stat.birthtime, stat && stat.mtime]) {
    const t = d instanceof Date ? d.getTime() : NaN;
    if (Number.isFinite(t) && t > Date.UTC(2000, 0, 1)) return new Date(t).toISOString();
  }
  return now;
}

/* Lane B4b: New project from a video... takes the videos and their
   transcripts in one pick. The extensions each kind has. */
const VIDEO_EXTENSIONS = ["mp4", "mkv", "webm", "mov", "avi"];
const TRANSCRIPT_EXTENSIONS = ["vtt", "docx"];

function _fileName(p) { return path.basename(String(p || "")); }
function _ext(p) { return path.extname(_fileName(p)).slice(1).toLowerCase(); }
function _stem(p) { return path.parse(_fileName(p)).name.toLowerCase(); }

/* Files in the order of their names, as the chain takes several videos
   ("part 2" before "part 10", case blind; flow-view-video.js attachVideo). */
function byName(a, b) {
  return _fileName(a).localeCompare(_fileName(b), undefined, { numeric: true, sensitivity: "base" });
}

/* The files picked (or dropped), sorted by kind: { videos, transcripts,
   others }, each in the order of their names. */
function sortPicked(paths) {
  const out = { videos: [], transcripts: [], others: [] };
  for (const p of paths || []) {
    if (typeof p !== "string" || !p) continue;
    const ext = _ext(p);
    (VIDEO_EXTENSIONS.includes(ext) ? out.videos : TRANSCRIPT_EXTENSIONS.includes(ext) ? out.transcripts : out.others).push(p);
  }
  for (const k of Object.keys(out)) out[k].sort(byName);
  return out;
}

/* Which video each transcript goes with (one transcript a video, C23):
   first the transcript whose file name shares its stem with a video's (the
   same stem first, else one stem starting with the other, case blind; the
   longest video stem wins), then the rest to the videos left, in order, one
   each. `videos` and `transcripts` in chain and name order. Returns
   { pairs: [{ video, transcript }] in the videos' order, unmatched: the
   transcripts left with no video }. */
function matchTranscripts(videos, transcripts) {
  const vids = (videos || []).slice(), left = (transcripts || []).slice();
  const taken = new Map();   // video -> transcript
  const take = (rank) => {
    for (const t of left.slice()) {
      const ts = _stem(t);
      const fits = vids.filter((v) => !taken.has(v) && rank(_stem(v), ts));
      if (!fits.length) continue;
      fits.sort((a, b) => _stem(b).length - _stem(a).length);
      taken.set(fits[0], t);
      left.splice(left.indexOf(t), 1);
    }
  };
  take((vs, ts) => vs === ts);
  take((vs, ts) => vs.startsWith(ts) || ts.startsWith(vs));
  for (const v of vids) {
    if (!left.length) break;
    if (!taken.has(v)) taken.set(v, left.shift());
  }
  return { pairs: vids.filter((v) => taken.has(v)).map((v) => ({ video: v, transcript: taken.get(v) })), unmatched: left };
}

/* The videos of a project made from videos, back to back on its clock
   (C23): [{ path, offset_ms, length_ms }] in the order given. `lengths`
   (ms, measured by the renderer) aligned with `videos`; every video but the
   last needs one, else an Error says which cannot be placed. */
function chainOf(videos, lengths) {
  const out = [];
  let at = 0;
  (videos || []).forEach((p, i) => {
    const len = lengths && typeof lengths[i] === "number" && Number.isFinite(lengths[i]) && lengths[i] > 0 ? Math.round(lengths[i]) : null;
    out.push({ path: p, offset_ms: at, length_ms: len });
    if (i < videos.length - 1) {
      if (len == null) throw new Error("the length of " + _fileName(p) + " cannot be read, so the videos after it cannot be put after it");
      at += len;
    }
  });
  return out;
}

/* Make the project. plan = { folder, kind: "video" | "blank", name,
   videoPath, videos ([{ path, offset_ms, length_ms }], chainOf's: several
   videos back to back; else the one videoPath at 0), id, now }. Resolves
   { folder }; on a failure the files it made are removed again and the
   error is thrown. */
async function createProject(plan, fs = nodeFs) {
  const folder = path.resolve(plan.folder);
  const why = folderProblem(folder, fs);
  if (why) throw new Error("the project cannot go there: " + why);
  const video = plan.kind === "video";
  const clips = video ? (Array.isArray(plan.videos) && plan.videos.length ? plan.videos
    : [{ path: plan.videoPath, offset_ms: 0, length_ms: null }]) : [];
  const made = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });
  try {
    const manifest = {
      session_id: plan.id,
      source: video ? "video" : "blank",
      started_at: video ? startedAtOf(fs.statSync(clips[0].path), plan.now) : plan.now,
      label: plan.name,
    };
    const anno = { version: 1, session_id: plan.id, steps: [] };
    if (video) {
      // C23 (2.0.6): the chain, v1 first. Each copied before the next is
      // planned, so two videos of the same name keep two copies.
      anno.external_videos = [];
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i];
        const storePlan = VideoPath.storePlan(folder, c.path, {
          exists: fs.existsSync,
          size: (p) => { try { return fs.statSync(p).size; } catch (_) { return null; } },
        });
        if (storePlan.copyTo) {
          await fs.promises.mkdir(path.dirname(storePlan.copyTo), { recursive: true });
          await fs.promises.copyFile(c.path, storePlan.copyTo);
        }
        const clip = { id: "v" + (i + 1), path: storePlan.stored, offset_ms: c.offset_ms || 0, in_ms: 0, out_ms: null };
        if (c.length_ms != null) clip.length_ms = c.length_ms;
        clip.attached_at = plan.now;
        anno.external_videos.push(clip);
      }
    }
    fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(folder, "events.jsonl"), "");
    fs.writeFileSync(path.join(folder, "annotations.json"), JSON.stringify(anno, null, 2));
    return { folder };
  } catch (e) {
    try {
      if (made) fs.rmSync(folder, { recursive: true, force: true });
      else for (const f of fs.readdirSync(folder)) fs.rmSync(path.join(folder, f), { recursive: true, force: true });
    } catch (_) { /* what is left is an unfinished folder the analyst can delete */ }
    throw e;
  }
}

module.exports = {
  folderProblem, startedAtOf, createProject,
  VIDEO_EXTENSIONS, TRANSCRIPT_EXTENSIONS, byName, sortPicked, matchTranscripts, chainOf,
};
