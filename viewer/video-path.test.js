"use strict";
/*
 * video-path.js (lane V2 item 5): the attached video travels in the
 * recording folder. Attach copies it into video/ and stores the path
 * relative to the folder; loading resolves it there, an older absolute path
 * still works, and a missing absolute path falls back to a file of its name
 * in the folder.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const VP = require("./video-path.js");

const ROOT = path.resolve("/rec/sess-1");
const inRoot = (...p) => path.join(ROOT, ...p);

/* A fake file set: { absolute path: size }. */
function files(map) {
  return { exists: (p) => Object.prototype.hasOwnProperty.call(map, path.resolve(p)), size: (p) => (map[path.resolve(p)] ?? null) };
}

test("a video outside the folder is copied into video/ and stored relative to the folder", () => {
  const src = path.resolve("/calls/Teams call.mp4");
  const fsx = files({ [src]: 1000 });
  assert.deepEqual(VP.storePlan(ROOT, src, fsx), { stored: "video/Teams call.mp4", copyTo: inRoot("video", "Teams call.mp4") });
});

test("a video already inside the folder is stored relative, with no copy", () => {
  const fsx = files({ [inRoot("video", "call.webm")]: 5 });
  assert.deepEqual(VP.storePlan(ROOT, inRoot("video", "call.webm"), fsx), { stored: "video/call.webm", copyTo: null });
  assert.deepEqual(VP.storePlan(ROOT, inRoot("call.webm"), files({})), { stored: "call.webm", copyTo: null });
});

test("the same file attached again is not copied twice; another file of the same name gets a numbered name", () => {
  const src = path.resolve("/calls/call.mp4");
  assert.deepEqual(VP.storePlan(ROOT, src, files({ [src]: 7, [inRoot("video", "call.mp4")]: 7 })),
    { stored: "video/call.mp4", copyTo: null });
  assert.deepEqual(VP.storePlan(ROOT, src, files({ [src]: 7, [inRoot("video", "call.mp4")]: 9 })),
    { stored: "video/call (2).mp4", copyTo: inRoot("video", "call (2).mp4") });
});

test("loading: a relative path resolves against the folder, wherever the folder now is", () => {
  const moved = path.resolve("/elsewhere/sess-1");
  const exists = (p) => path.resolve(p) === path.join(moved, "video", "call.webm");
  assert.equal(VP.resolveStored(moved, "video/call.webm", exists), path.join(moved, "video", "call.webm"));
  assert.equal(VP.resolveStored(ROOT, "video/call.webm", exists), null, "not in this folder");
});

test("loading: an old absolute path still works; when it is missing, a file of its name in the folder is used", () => {
  const abs = path.resolve("/pm-laptop/videos/call.webm");
  assert.equal(VP.resolveStored(ROOT, abs, (p) => path.resolve(p) === abs), abs);
  assert.equal(VP.resolveStored(ROOT, "C:\\Users\\pm\\Videos\\call.webm", (p) => path.resolve(p) === inRoot("call.webm")), inRoot("call.webm"));
  assert.equal(VP.resolveStored(ROOT, abs, (p) => path.resolve(p) === inRoot("video", "call.webm")), inRoot("video", "call.webm"));
  assert.equal(VP.resolveStored(ROOT, abs, () => false), null);
});

test("a stored path that leaves the folder is never followed out of it", () => {
  const exists = (p) => path.resolve(p) === path.resolve("/rec/secret.webm") || path.resolve(p) === inRoot("secret.webm");
  assert.equal(VP.resolveStored(ROOT, "../secret.webm", exists), inRoot("secret.webm"), "only its name, inside the folder");
  assert.equal(VP.resolveStored(ROOT, "", exists), null);
  assert.equal(VP.baseName("C:\\a\\b\\c.mp4"), "c.mp4");
});
