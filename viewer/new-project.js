/*
 * new-project.js: a session folder made without a recording (contract C16),
 * main process only. "New project from a video..." makes one around a video
 * (copied into its video/ folder, the path stored relative to the folder,
 * offset 0); "New empty project..." makes an empty one. Each gets manifest.json
 * (session_id, source, started_at, label: the name the analyst gave), an
 * empty events.jsonl and annotations.json. The analysis then gives it one
 * implicit run (the pipeline's half of C16).
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

/* Make the project. plan = { folder, kind: "video" | "blank", name,
   videoPath, id, now }. Resolves { folder }; on a failure the files it made
   are removed again and the error is thrown. */
async function createProject(plan, fs = nodeFs) {
  const folder = path.resolve(plan.folder);
  const why = folderProblem(folder, fs);
  if (why) throw new Error("the project cannot go there: " + why);
  const video = plan.kind === "video";
  const made = !fs.existsSync(folder);
  fs.mkdirSync(folder, { recursive: true });
  try {
    const manifest = {
      session_id: plan.id,
      source: video ? "video" : "blank",
      started_at: video ? startedAtOf(fs.statSync(plan.videoPath), plan.now) : plan.now,
      label: plan.name,
    };
    const anno = { version: 1, session_id: plan.id, steps: [] };
    if (video) {
      const storePlan = VideoPath.storePlan(folder, plan.videoPath, {
        exists: fs.existsSync,
        size: (p) => { try { return fs.statSync(p).size; } catch (_) { return null; } },
      });
      if (storePlan.copyTo) {
        await fs.promises.mkdir(path.dirname(storePlan.copyTo), { recursive: true });
        await fs.promises.copyFile(plan.videoPath, storePlan.copyTo);
      }
      // C23 (2.0.6): the first video of the chain.
      anno.external_videos = [{ id: "v1", path: storePlan.stored, offset_ms: 0, in_ms: 0, out_ms: null, attached_at: plan.now }];
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

module.exports = { folderProblem, startedAtOf, createProject };
