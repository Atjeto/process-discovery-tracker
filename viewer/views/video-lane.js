/*
 * video-lane.js: the Timeline's Videos lane (contract C23, 2.0.6). One band
 * per video of the project, where it is on the one clock, named after its
 * file, as in a video editor: a click goes to that moment; a side dragged
 * trims it (the time in its file follows the pointer, kept within the file);
 * a right-click (lane LANES: "every Timeline right-click marks there, on a
 * band too") first offers what a right-click on the timeline offers at that
 * moment (the Timeline's own menu, as a step's band does), then, under the
 * video's name, trims the start or the end at that moment, gives a trimmed
 * side back, syncs it (in a recording), replaces it, removes it, or adds a
 * video. Every act is flow-view-video.js's (one undoable edit each), so a
 * project made from videos moves what follows a video whose length changes,
 * and a recording moves nothing else.
 *
 * Present only while the project has a video the analyst added (a
 * recording's own video is the recording, not a video of the chain). A
 * plugin flow-view-timeline.js stacks (renderLaneNames names it at the
 * left), so this module never require()s that one.
 */

"use strict";

const State = require("../state.js");
const RO = require("../read-only.js");
const { escapeHtml, recordingStartMs, sinceStart, formatDuration } = require("../dom.js");
const Video = require("./flow-view-video.js");

const LANE_H = 24;
const BAND_H = 18;
/* A side within this many pixels of the pointer is the one a drag takes. */
const SIDE_PX = 6;

/* What a band says when pointed at: its file, where it is, how long it is,
   what of it is trimmed, and what to do with it. */
function _title(clip, sp, origin, editable) {
  const lines = [Video.clipName(clip) + (clip.file ? "" : " (its file is not found on this computer)")];
  if (sp) {
    lines.push("From " + sinceStart(new Date(sp.startMs).toISOString(), origin) +
      (sp.endMs != null ? " to " + sinceStart(new Date(sp.endMs).toISOString(), origin) + " · " + formatDuration(sp.endMs - sp.startMs) : ""));
  }
  const trimmed = [clip.in_ms > 0 ? "its first " + formatDuration(clip.in_ms) : "",
    clip.out_ms != null && Video.lengthOf(clip) ? "its last " + formatDuration(Video.lengthOf(clip) - clip.out_ms) : ""].filter(Boolean);
  if (trimmed.length) lines.push("Trimmed: " + trimmed.join(" and ") + ".");
  lines.push(editable ? "Click: go there. Drag a side: trim it. Right-click: trim here, replace or remove it." : "Click: go there.");
  return lines.join("\n");
}

/* The lane plugin. env = { first, last, span, on, bandMenu(x, y, at, title,
   items) }: the timeline's span, the lane toggle, and the Timeline's menu at
   the moment `at` (an ISO time) with a band's own `items` ([label, act])
   under its `title` (flow-view.js showMarkerInsertMenu). */
function videoLane(env) {
  const sess = State.getSession();
  const clips = Video.addedClips(sess);
  const editable = !RO.isReadOnly(sess);
  return {
    key: "videos",
    height: clips.length && env.on ? LANE_H : 0,
    gapBefore: 4,
    render(host, ctx) {
      const origin = recordingStartMs(sess);
      const toPct = (ms) => ((ms - env.first) / env.span) * 100;
      const msAt = (clientX) => {
        const rect = host.getBoundingClientRect();
        return env.first + ((clientX - rect.left) / Math.max(1, rect.width)) * env.span;
      };
      const spans = clips.map((c) => ({ clip: c, sp: Video.clipSpan(c, sess) })).filter((x) => x.sp);
      spans.forEach(({ clip, sp }, i) => {
        // A video whose length is not known yet runs to the next one, or to the end.
        const next = spans[i + 1];
        const end = sp.endMs != null ? sp.endMs : (next ? next.sp.startMs : env.last);
        const band = document.createElement("div");
        band.className = "tl-clip" + (clip.file ? "" : " missing") + (clip.in_ms > 0 ? " trimmed-start" : "") +
          (clip.out_ms != null ? " trimmed-end" : "");
        band.dataset.clip = clip.id;
        band.style.left = toPct(sp.startMs) + "%";
        band.style.width = Math.max(0.2, toPct(end) - toPct(sp.startMs)) + "%";
        band.style.top = (ctx.slot.top + (LANE_H - BAND_H) / 2) + "px";
        band.style.height = BAND_H + "px";
        band.innerHTML = '<span class="tl-clip-name">' + escapeHtml(Video.clipName(clip)) + "</span>";
        band.title = _title(clip, sp, origin, editable);
        const length = Video.lengthOf(clip);
        const sideAt = (clientX) => {
          if (!editable || !clip.file || !length) return null;
          const r = band.getBoundingClientRect();
          if (clientX - r.left <= SIDE_PX) return "start";
          if (r.right - clientX <= SIDE_PX) return "end";
          return null;
        };
        band.addEventListener("mousemove", (e) => band.classList.toggle("tl-edge-hot", !!sideAt(e.clientX)));
        band.addEventListener("mouseleave", () => band.classList.remove("tl-edge-hot"));
        band.addEventListener("click", (e) => {
          e.stopPropagation();
          if (band.dataset.dragged) { delete band.dataset.dragged; return; }
          Video.seekToTimestamp(new Date(Math.max(sp.startMs, Math.min(end - 1, msAt(e.clientX)))).toISOString());
        });
        // Drag a side: the time in the file follows the pointer, within the
        // file and keeping at least a second; applied on release.
        band.addEventListener("mousedown", (e) => {
          const edge = e.button === 0 ? sideAt(e.clientX) : null;
          if (!edge) return;
          e.preventDefault();
          e.stopPropagation();
          let sourceMs = null;
          const onMove = (ev) => {
            const t = msAt(ev.clientX) - sp.fileStartMs;
            sourceMs = Math.max(0, Math.min(length, Math.round(t)));
            const at = sp.fileStartMs + sourceMs;
            if (edge === "start") {
              band.style.left = toPct(at) + "%";
              band.style.width = Math.max(0.2, toPct(end) - toPct(at)) + "%";
            } else {
              band.style.width = Math.max(0.2, toPct(at) - toPct(sp.startMs)) + "%";
            }
            band.classList.add("tl-clip-dragging");
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            band.classList.remove("tl-clip-dragging");
            if (sourceMs == null) return;
            band.dataset.dragged = "1";
            Video.trimVideo(clip.id, edge, sourceMs).then((saved) => { if (!saved) require("./flow-view-timeline.js").renderTimeline(); });
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        band.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!editable) return;
          const ms = msAt(e.clientX);
          const inFile = Math.round(ms - sp.fileStartMs);
          const items = [];
          if (clip.file && length && ms > sp.startMs && ms < end) {
            items.push(["Trim the start here", () => Video.trimVideo(clip.id, "start", inFile)]);
            items.push(["Trim the end here", () => Video.trimVideo(clip.id, "end", inFile)]);
          }
          if (clip.in_ms > 0 && length) items.push(["Give its start back", () => Video.trimVideo(clip.id, "start", 0)]);
          if (clip.out_ms != null && length) items.push(["Give its end back", () => Video.trimVideo(clip.id, "end", length)]);
          if (!Video.isBackToBack(sess) && clip.file) items.push(["Sync video...", () => Video.syncVideo(clip.id)]);
          items.push([clip.file ? "Replace video..." : "Find the video...", () => Video.replaceVideo(clip.id)]);
          items.push(["Remove video", () => Video.removeVideo(clip.id)]);
          items.push(["Add a video...", () => Video.attachVideo()]);
          // The moment's marks first (Add a step here, a transaction, a
          // note), then the video's own acts under its name.
          env.bandMenu(e.clientX, e.clientY, new Date(ms).toISOString(), Video.clipName(clip), items);
        });
        host.appendChild(band);
      });
    },
  };
}

module.exports = { videoLane, LANE_H };
