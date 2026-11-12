"use strict";
/*
 * Video chain e2e smoke (2.0.6, contract C23; the owner: "10th minute on the
 * timeline is 10th minute on the timeline, regardless if there are 1 or 7
 * videos on the timeline"). Launches the REAL viewer on a throwaway profile,
 * the main process's file dialogs replaced, on a project made from a
 * synthetic 32 s video in a temp folder, and drives it as a person does:
 *   (a) Add another on the Overview's project line, with a 12 s video: it
 *       goes after the first, back to back (offset 32 s, its length read
 *       from a file that holds none), copied into video/; the Videos lane
 *       draws two bands and the timeline runs 44 s; the line says 2 videos;
 *   (b) a click on the timeline at 0:36 plays the second video at 4 s, the
 *       playhead at 0:36; played from 0:31, the first video goes on into the
 *       second;
 *   (b2) lane W2: the speed chosen in the row (2x) holds across the chain:
 *       the second video plays at 2x, the clock twice as fast as real time;
 *   (c) a transaction started at 0:34 and a step marked at 0:38 (both on
 *       the second video); the first video's end trimmed at 0:28 (its band's
 *       right-click): the second video, the transaction's start and the step
 *       move up 4 s, the timeline runs 40 s; Ctrl+Z puts them all back;
 *   (d) a trim of the second video's start at 0:40 (the step starts at 0:38,
 *       in the part cut away) is refused, saying what is there; nothing
 *       changes;
 *   (e) a transcript attached asks which video it is of: the second; its
 *       first sentence (1 s into it) is at 0:33; a second transcript added,
 *       of the first video, at 0:01; the first video trimmed again: the
 *       second video's transcript moves with it, the first's stays;
 *   (f) the PDD's step line reads the timeline's clock ("Transaction 1 at
 *       0:34"), never a time in a video; Document control says 2 videos;
 *   (g) the first video removed (its band's right-click, asked first,
 *       naming the step marked on it): it goes with that step, and what
 *       follows moves up by its length (the second video at 0:00, the
 *       transaction's start at 0:02); Ctrl+Z brings it all back;
 *   (h) the second video's end dragged on its band to 0:40 trims it there;
 *       Ctrl+Z gives it back;
 *   (i) lane LANES: a right-click on a video's band marks there too: the
 *       Timeline's own entries first (Add a step here among them), then,
 *       under the video's name, the video's own entries; Add a step here
 *       adds a step at that moment;
 *   zero page errors. Exits 0 when every check passed, 1 on a failed check,
 *   2 when it could not run.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const VIDEO_A = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");   // companion-smoke's, made here when absent
const VIDEO_B = path.join(os.tmpdir(), "pdt-e2e-synthetic-12s-v1.webm");
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("video-chain-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const zlib = require("zlib");

/* The entries of a .docx (a zip): { name: Buffer }. Stored or deflated. */
function zipFiles(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const out = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < buf.readUInt16LE(eocd + 10); k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), local = buf.readUInt32LE(p + 42);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/* A synthetic video recorded in the viewer's own window (a canvas and
   MediaRecorder: its file holds no length), made once. */
async function makeVideo(page, out, secs, colour) {
  if (fs.existsSync(out)) return;
  await page.evaluate(async ({ file, ms, bg }) => {
    const cv = document.createElement("canvas");
    cv.width = 320; cv.height = 180;
    cv.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(cv);
    const gx = cv.getContext("2d");
    const rec = new MediaRecorder(cv.captureStream(10), { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    const t0 = performance.now();
    const draw = () => { gx.fillStyle = bg; gx.fillRect(0, 0, 320, 180); gx.fillStyle = "#fff"; gx.font = "28px monospace";
      gx.fillText("video " + ((performance.now() - t0) / 1000).toFixed(1), 20, 100); };
    draw();
    const iv = setInterval(draw, 100);
    rec.start(1000);
    await new Promise((r) => setTimeout(r, ms));
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    clearInterval(iv);
    cv.remove();
    require("fs").writeFileSync(file, Buffer.from(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
  }, { file: out, ms: secs * 1000, bg: colour });
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-chain-"));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#btn-recent-menu", { timeout: T });
  } catch (e) { console.error("[video-chain-e2e] FATAL:", e); process.exit(2); }
  const app = v.app;

  const anno = () => page.evaluate(() => require("./state.js").getSession().annotations);
  const level = async (l) => { await page.locator('.view-mode-btn[data-level="' + l + '"]').click({ timeout: T }); await wait(300); };
  const stubOpen = (files) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, files);
  const stubSave = (p) => app.evaluate(({ dialog, shell }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
    shell.showItemInFolder = () => {};
  }, p);
  const prompt = async (text) => {
    await page.waitForSelector(".modal-prompt .modal-input", { timeout: T });
    await page.fill(".modal-prompt .modal-input", text);
    await page.click(".modal-prompt .modal-ok");
    await page.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
  };
  const geo = () => page.evaluate(() => {
    const r = document.getElementById("timeline").getBoundingClientRect();
    const sp = require("./views/flow-view-video.js").timelineSpan();
    const band = document.querySelector("#timeline .tl-case-band");
    const clip = document.querySelector("#timeline .tl-clip");
    return { left: r.left, width: r.width, top: r.top, first: sp.startMs, span: sp.endMs - sp.startMs,
      lowY: band ? band.getBoundingClientRect().bottom + 14 : r.top + 34,
      clipY: clip ? clip.getBoundingClientRect().top + clip.getBoundingClientRect().height / 2 : null };
  });
  const xOf = (g, ms) => g.left + ((ms - g.first) / g.span) * g.width;
  const menuItem = async (label) => page.locator("#tl-ctx-menu div", { hasText: label }).first().click({ timeout: T });
  const rightClickItem = async (x, y, label) => {
    await page.mouse.click(x, y, { button: "right" });
    await menuItem(label);
  };
  const apply = async () => {
    const deadline = Date.now() + 120000;
    for (;;) {
      const done = await page.evaluate(() => {
        const s = require("./state.js").getSession(), ME = require("./marker-edits.js");
        return ME.pendingEditCount(s.annotations.marker_edits, ME.lastAnalysisMs(s)) === 0 &&
          !document.getElementById("run-status") && !require("./views/flow-view.js").analysisBusy();
      });
      if (done || Date.now() > deadline) break;
      await wait(250);
    }
    await wait(500);
  };
  const toastText = () => page.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim());
  // The chain as stored: [id, offset s, in s, out s | null, length s].
  const chain = async () => ((await anno()).external_videos || []).map((c) => [c.id, c.offset_ms / 1000, c.in_ms / 1000,
    c.out_ms == null ? null : c.out_ms / 1000, c.length_ms == null ? null : Math.round(c.length_ms / 100) / 10]);
  const spanSecs = () => page.evaluate(() => { const sp = require("./views/flow-view-video.js").timelineSpan();
    return sp ? (sp.endMs - sp.startMs) / 1000 : null; });
  const player = () => page.evaluate(() => {
    const v = document.getElementById("video"), Vd = require("./views/flow-view-video.js");
    const at = Vd.playheadMs(), s = require("./state.js").getSession();
    return { src: decodeURIComponent(v.currentSrc || v.src || "").split("/").pop(), t: v.currentTime, paused: v.paused,
      clip: (Vd.currentClip() || {}).id || null, clock: at == null ? null : (at - Date.parse(s.manifest.started_at)) / 1000 };
  });
  const undo = async () => { await page.evaluate(async () => { await require("./session.js").performUndo(); }); };
  const relOf = (iso) => (Date.parse(iso) - origin) / 1000;
  let origin = NaN;
  const at = (sec) => origin + sec * 1000;
  const atClick = (sec) => at(sec + 0.4);   // a click lands within a pixel: the clock reads `sec`

  await makeVideo(page, VIDEO_A, 32, "#123");
  await makeVideo(page, VIDEO_B, 12, "#512");

  const PROJ = path.join(TMP, "Order call");
  let stepId = null, earlyStep = null;

  // (a) Add another: back to back after the first.
  let a = {};
  try {
    await stubOpen([VIDEO_A]);
    await stubSave(PROJ);
    await page.click("#btn-new-menu");
    await page.click("#btn-new-from-video");
    await page.waitForFunction((f) => { const s = require("./state.js").getSession();
      return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase() && !!s.stats && !document.getElementById("run-status"); },
    path.resolve(PROJ), { timeout: 120000 });
    origin = Date.parse(readJson(path.join(PROJ, "manifest.json")).started_at);
    await level("flow");
    await page.waitForFunction(() => !!require("./views/flow-view-video.js").timelineSpan(), null, { timeout: 30000 });
    await level("overview");
    a.lineBefore = await page.evaluate(() => [...document.querySelectorAll("#ov-summary .ov-summary-line button")].map((b) => b.id + ":" + b.textContent.trim()));
    await stubOpen([VIDEO_B]);
    await page.locator("#ov-summary #btn-add-video").click({ timeout: T });
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.external_videos || []).length === 2, null, { timeout: 60000 });
    await page.waitForFunction(() => /Video added after the last one/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    a.chain = await chain();
    a.copied = fs.existsSync(path.join(PROJ, "video", path.basename(VIDEO_B)));
    a.line = await page.evaluate(() => ((document.querySelector('#ov-summary [data-summary="video"]') || {}).textContent || "").trim());
    await level("flow");
    await page.waitForFunction(() => document.querySelectorAll("#timeline .tl-clip").length === 2, null, { timeout: T });
    a.span = await spanSecs();
    a.lane = await page.evaluate(() => ({ name: !!document.querySelector('#tl-lane-names .tl-lane-name[data-lane="videos"]'),
      bands: [...document.querySelectorAll("#timeline .tl-clip")].map((b) => b.textContent.trim()) }));
  } catch (e) { a.err = errText(e); }
  record("(a) Add another puts the 12 s video after the 32 s one, back to back (its length read from a file that holds none), copied into video/; the Videos lane draws both and the timeline runs 44 s",
    !a.err && a.lineBefore && a.lineBefore.includes("btn-add-video:Add another") && a.chain && a.chain.length === 2 &&
      a.chain[0][0] === "v1" && a.chain[1][0] === "v2" && near(a.chain[1][1], 32, 0.4) && near(a.chain[1][4], 12, 0.4) &&
      a.copied && a.line === "2 videos" && near(a.span, 44, 0.8) && a.lane.name && a.lane.bands.length === 2,
    JSON.stringify(a));

  // (b) The clock across the boundary.
  let b = {};
  try {
    const g = await geo();
    await page.mouse.click(xOf(g, at(36)), g.lowY);
    await page.waitForFunction(() => { const v = document.getElementById("video"); return /12s/.test(decodeURIComponent(v.currentSrc || "")) && v.currentTime > 3; },
      null, { timeout: T });
    await page.evaluate(() => document.getElementById("video").pause());
    b.at36 = await player();
    // Played from 0:31 on the first video, it goes on into the second.
    await page.evaluate(() => { const v = document.getElementById("video"); v.muted = true; });
    await page.mouse.click(xOf(g, at(31)), g.lowY);
    await page.waitForFunction(() => /32s/.test(decodeURIComponent(document.getElementById("video").currentSrc || "")), null, { timeout: T });
    await page.waitForFunction(() => /12s/.test(decodeURIComponent(document.getElementById("video").currentSrc || "")) &&
      !document.getElementById("video").paused, null, { timeout: 15000 });
    b.after = await player();
    await page.evaluate(() => document.getElementById("video").pause());
  } catch (e) { b.err = errText(e); }
  record("(b) a click at 0:36 plays the second video at 4 s (the playhead at 0:36); played from 0:31, the first video goes on into the second",
    !b.err && b.at36 && b.at36.clip === "v2" && near(b.at36.t, 4, 0.8) && near(b.at36.clock, 36, 0.8) &&
      b.after && b.after.clip === "v2" && b.after.clock > 31.5, JSON.stringify(b));

  // (b2) Lane W2: the speed, chosen in the row, holds across the videos of
  // the chain: played at 2x from 0:30, the second video plays at 2x too, the
  // clock running twice as fast there (two readings over a second of real
  // time); kept on this computer.
  let sp = {};
  try {
    await page.selectOption("#tl-speed", "2");
    await page.evaluate((t) => { const v = document.getElementById("video"); v.muted = true;
      require("./views/flow-view-video.js").seekClock(t, true); }, at(30));
    await page.waitForFunction(() => /12s/.test(decodeURIComponent(document.getElementById("video").currentSrc || "")) &&
      !document.getElementById("video").paused && document.getElementById("video").currentTime > 0.5, null, { timeout: 15000 });
    const r1 = await page.evaluate(() => ({ at: require("./views/flow-view-video.js").playheadMs(), now: performance.now() }));
    await wait(1000);
    const r2 = await page.evaluate(() => ({ at: require("./views/flow-view-video.js").playheadMs(), now: performance.now(),
      rate: document.getElementById("video").playbackRate, clip: (require("./views/flow-view-video.js").currentClip() || {}).id }));
    await page.evaluate(() => document.getElementById("video").pause());
    sp = { ratio: Math.round(((r2.at - r1.at) / (r2.now - r1.now)) * 100) / 100, rate: r2.rate, clip: r2.clip,
      kept: await page.evaluate(() => localStorage.getItem("pdt.playbackRate")),
      choices: await page.evaluate(() => [...document.querySelectorAll("#tl-speed option")].map((o) => o.textContent)),
      title: await page.evaluate(() => document.getElementById("tl-speed").title) };
    await page.selectOption("#tl-speed", "1");
  } catch (e) { sp.err = errText(e); }
  record("(b2) lane W2: the speed (1x, 1.5x, 2x, \"How fast the video plays\") holds across the chain: played at 2x from 0:30, the second video plays at 2x, the clock running about twice as fast as real time, and the choice is kept on this computer",
    !sp.err && sp.clip === "v2" && sp.rate === 2 && sp.ratio >= 1.7 && sp.ratio <= 2.3 && sp.kept === "2" &&
      JSON.stringify(sp.choices) === '["1x","1.5x","2x"]' && sp.title === "How fast the video plays", JSON.stringify(sp));

  // (c) A trim of the first video's end, back to back: what follows moves up.
  let c = {};
  try {
    let g = await geo();
    await page.mouse.click(xOf(g, atClick(10)), g.lowY, { button: "right" });
    await menuItem("Add a step here");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 1, null, { timeout: T });
    earlyStep = (await anno()).steps[0].step_id;
    g = await geo();
    await rightClickItem(xOf(g, atClick(34)), g.lowY, "Start a transaction here");
    await prompt("Order 1");
    await apply();
    g = await geo();
    await rightClickItem(xOf(g, atClick(38)), g.lowY, "Add a step here");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 2, null, { timeout: T });
    stepId = (await anno()).steps.find((s) => s.step_id !== earlyStep).step_id;
    const before = await anno();
    c.before = { start: relOf(before.marker_edits.find((e) => e.op === "insert").timestamp),
      step: relOf(before.steps.find((s) => s.step_id === stepId).time_range.start) };
    c.v2Before = (await chain())[1][1];
    g = await geo();
    await rightClickItem(xOf(g, atClick(28)), g.clipY, "Trim the end here");
    await page.waitForFunction(() => /Video trimmed/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    c.toast = await toastText();
    await apply();
    const now = await anno();
    c.chain = await chain();
    // The first video is as long as its recorder made it (about 32 s): what
    // follows moves up by what was cut from it.
    c.shift = c.v2Before - c.chain[1][1];
    c.after = { start: relOf(now.marker_edits.find((e) => e.op === "insert").timestamp),
      step: relOf(now.steps.find((s) => s.step_id === stepId).time_range.start) };
    c.span = await spanSecs();
    await undo();
    await page.waitForFunction(() => { const v = require("./state.js").getSession().annotations.external_videos || [];
      return v.length === 2 && v[0].out_ms == null; }, null, { timeout: 60000 });
    await apply();
    const back = await anno();
    c.undone = { chain: await chain(), step: relOf(back.steps.find((s) => s.step_id === stepId).time_range.start) };
  } catch (e) { c.err = errText(e); }
  record("(c) the first video's end trimmed at 0:28: the second video, the transaction's start (0:34) and the step (0:38) move up 4 s, the timeline runs 40 s; Ctrl+Z puts them all back",
    !c.err && c.chain && near(c.chain[0][3], 28, 0.5) && near(c.chain[1][1], c.chain[0][3], 0.01) && near(c.shift, 3.6, 0.6) &&
      near(c.before.start, 34, 0.5) && near(c.after.start, c.before.start - c.shift, 0.05) &&
      near(c.before.step, 38, 0.5) && near(c.after.step, c.before.step - c.shift, 0.05) &&
      near(c.span, 44 - c.shift, 0.9) && /what follows moved with it/.test(c.toast || "") &&
      c.undone && c.undone.chain[0][3] === null && near(c.undone.chain[1][1], 32, 0.4) && near(c.undone.step, 38, 0.5),
    JSON.stringify(c));

  // (d) A trim that would cut a mark away is refused.
  let d = {};
  try {
    const before = JSON.stringify(await anno());
    const g = await geo();
    await rightClickItem(xOf(g, atClick(40)), g.clipY, "Trim the start here");
    await page.waitForFunction(() => /Something is marked in the part you trim away/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: T });
    d.toast = await toastText();
    d.same = JSON.stringify(await anno()) === before;
  } catch (e) { d.err = errText(e); }
  record("(d) a trim of the second video's start at 0:40 (a step starts at 0:38, in the part cut away) is refused, naming the step; nothing changes",
    !d.err && d.same && /"Step 2" starts there, at 0:38/.test(d.toast || ""), JSON.stringify(d));

  // (e) A transcript per video.
  let e2 = {};
  const VTT = path.join(TMP, "second part.vtt"), VTT1 = path.join(TMP, "first part.vtt");
  fs.writeFileSync(VTT, "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Ana>We open the second part here.</v>\n\n" +
    "00:00:05.000 --> 00:00:07.000\n<v Ana>Then we check the order.</v>\n", "utf-8");
  fs.writeFileSync(VTT1, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>This is the first part.</v>\n", "utf-8");
  const sentences = () => page.evaluate(() => {
    const s = require("./state.js").getSession(), placed = require("./transcript-model.js").forSession(s);
    const o = Date.parse(s.manifest.started_at);
    return placed ? placed.sentences.map((x) => [x.file, x.text, x.startMs == null ? null : (x.startMs - o) / 1000]) : [];
  });
  try {
    await level("overview");
    await stubOpen([VTT]);
    await page.locator("#ov-summary #btn-attach-transcript").click({ timeout: T });
    await page.waitForSelector(".modal-choose .modal-list", { timeout: T });
    e2.dialog = await page.evaluate(() => ({ title: document.querySelector(".modal-choose h2").textContent,
      options: [...document.querySelectorAll(".modal-choose option")].map((o) => o.textContent.trim()) }));
    await page.selectOption(".modal-choose .modal-list", "v2");
    await page.click(".modal-choose .modal-ok");
    await page.waitForFunction(() => /Transcript attached|not attached/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: 60000 });
    e2.toast = await toastText();
    e2.first = await sentences();
    await stubOpen([VTT1]);
    await page.locator("#ov-summary #btn-add-transcript").click({ timeout: T });
    await page.waitForSelector(".modal-choose .modal-list", { timeout: T });
    await page.selectOption(".modal-choose .modal-list", "v1");
    await page.click(".modal-choose .modal-ok");
    await page.waitForFunction(() => (require("./state.js").getSession().transcripts || []).length === 2, null, { timeout: 60000 });
    e2.both = await sentences();
    e2.files = fs.readdirSync(PROJ).filter((f) => /^transcript.*\.json$/.test(f)).sort();
    e2.line = await page.evaluate(() => ((document.querySelector('#ov-summary [data-summary="transcript"]') || {}).textContent || "").trim());
    await level("flow");
    e2.rows = await page.evaluate(() => [...document.querySelectorAll("#timeline .tl-tr-label")].map((l) => l.dataset.file));
    // Lane LANES: the Videos lane is under the Steps and the Transcript
    // lanes now; with two transcripts the lanes scroll, so its bands are
    // brought into view before the pointer goes there.
    await page.evaluate(() => document.querySelector("#timeline .tl-clip").scrollIntoView({ block: "nearest" }));
    const g = await geo();
    await rightClickItem(xOf(g, atClick(30)), g.clipY, "Trim the end here");
    await page.waitForFunction(() => { const v = require("./state.js").getSession().annotations.external_videos || [];
      return v.length === 2 && v[0].out_ms != null; }, null, { timeout: T });
    await apply();
    e2.trimmed = await sentences();
    await undo();
    await page.waitForFunction(() => { const v = require("./state.js").getSession().annotations.external_videos || [];
      return v.length === 2 && v[0].out_ms == null; }, null, { timeout: 60000 });
    await apply();
  } catch (e) { e2.err = errText(e); }
  const s1 = (list, text) => (list || []).find((x) => x[1] === text);
  record("(e) a transcript attached asks which video it is of; of the second, its first sentence is at 0:33; one added of the first is at 0:01; the first video trimmed, the second's transcript moves with its video and the first's stays",
    !e2.err && e2.dialog && /Which video/.test(e2.dialog.title) && e2.dialog.options.length === 2 &&
      near((s1(e2.first, "We open the second part here.") || [])[2], 33, 0.5) &&
      near((s1(e2.both, "This is the first part.") || [])[2], 1, 0.3) &&
      JSON.stringify(e2.files) === '["transcript-2.json","transcript.json"]' && e2.line === "2 transcripts" &&
      e2.rows && e2.rows.length === 2 &&
      near((s1(e2.trimmed, "We open the second part here.") || [])[2], 31, 0.6) &&
      near((s1(e2.trimmed, "This is the first part.") || [])[2], 1, 0.3),
    JSON.stringify(e2));

  // (f) The PDD on the timeline's clock.
  let f = {};
  try {
    const out = path.join(TMP, "chain PDD export");
    await stubSave(out);
    await page.click("#btn-session-export-menu");
    await page.click("#btn-session-pdd");
    let files = null;
    for (const deadline = Date.now() + 180000; Date.now() < deadline && !files;) {
      if (fs.existsSync(out)) {
        const buf = fs.readFileSync(out);
        if (buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b) { await wait(500); files = zipFiles(fs.readFileSync(out)); }
      }
      if (!files) await wait(500);
    }
    if (!files) throw new Error("no PDD written to " + out);
    const txt = files["word/document.xml"].toString("utf8").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<[^>]+>/g, "");
    f.line = (txt.split("\n").find((l) => /Transaction 1 at /.test(l)) || "").trim();
    f.video = /video \d+:\d\d/.test(txt);
    f.control = /Video \| 2 videos/.test(txt.replace(/\n/g, " | ").replace(/( \| )+/g, " | ")) ? "Video | 2 videos" : "";
  } catch (e) { f.err = errText(e); }
  record("(f) the PDD's step line reads the timeline's clock (Transaction 1 at 0:38), never a time in a video; Document control says 2 videos",
    !f.err && /Transaction 1 at 0:38/.test(f.line || "") && !f.video && /2 videos/.test(f.control || ""), JSON.stringify(f));

  // (g) Remove the first video: what was on it goes, what follows moves up.
  let gg = {};
  try {
    await level("flow");
    // Lane LANES: the Videos lane is under the Steps and the Transcript
    // lanes now; with two transcripts the lanes scroll, so its bands are
    // brought into view before the pointer goes there.
    await page.evaluate(() => document.querySelector("#timeline .tl-clip").scrollIntoView({ block: "nearest" }));
    const g = await geo();
    await rightClickItem(xOf(g, atClick(12)), g.clipY, "Remove video");
    await page.waitForSelector(".modal-confirm", { state: "visible", timeout: T });
    gg.confirm = ((await page.locator(".modal-confirm").textContent({ timeout: T })) || "").replace(/\s+/g, " ").trim();
    await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.external_videos || []).length === 1, null, { timeout: T });
    await apply();
    const now = await anno();
    gg.chain = await chain();
    gg.steps = now.steps.map((s) => [s.step_id === stepId ? "late" : s.step_id === earlyStep ? "early" : s.step_id, relOf(s.time_range.start)]);
    gg.start = relOf(now.marker_edits.find((e) => e.op === "insert").timestamp);
    gg.copyGone = !fs.existsSync(path.join(PROJ, "video", path.basename(VIDEO_A)));
    await undo();
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.external_videos || []).length === 2, null, { timeout: 60000 });
    await apply();
    const back = await anno();
    gg.undone = { chain: await chain(), steps: back.steps.length, copyBack: fs.existsSync(path.join(PROJ, "video", path.basename(VIDEO_A))) };
  } catch (e) { gg.err = errText(e); }
  record("(g) the first video removed (asked first, naming the step marked on it): it goes with that step, the second video starts at 0:00 and the transaction at 0:02, the step at 0:06; Ctrl+Z brings it all back",
    !gg.err && /Remove .*32s.*\?/.test(gg.confirm || "") && /1 step/.test(gg.confirm || "") &&
      gg.chain && gg.chain.length === 1 && gg.chain[0][0] === "v2" && near(gg.chain[0][1], 0, 0.3) &&
      JSON.stringify(gg.steps.map((x) => x[0])) === '["late"]' && near(gg.steps[0][1], 6, 0.6) && near(gg.start, 2, 0.6) && gg.copyGone &&
      gg.undone && gg.undone.chain.length === 2 && gg.undone.steps === 2 && gg.undone.copyBack,
    JSON.stringify(gg));

  // (h) A side dragged trims: the second video's end, from its band's right
  // edge to 0:40, with the real mouse.
  let hh = {};
  try {
    await level("flow");
    // Lane LANES: the Videos lane is under the Steps and the Transcript
    // lanes now; with two transcripts the lanes scroll, so its bands are
    // brought into view before the pointer goes there.
    await page.evaluate(() => document.querySelector("#timeline .tl-clip").scrollIntoView({ block: "nearest" }));
    const g = await geo();
    const band = await page.evaluate(() => { const b = document.querySelectorAll("#timeline .tl-clip")[1].getBoundingClientRect();
      return { right: b.right, y: b.top + b.height / 2 }; });
    const to = xOf(g, at(40));
    await page.mouse.move(band.right - 2, band.y);
    hh.hot = await page.evaluate(() => document.querySelectorAll("#timeline .tl-clip")[1].classList.contains("tl-edge-hot"));
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(band.right - 2 - ((band.right - 2 - to) * k) / 8, band.y);
    await page.mouse.up();
    await page.waitForFunction(() => { const v = require("./state.js").getSession().annotations.external_videos || [];
      return v.length === 2 && v[1].out_ms != null; }, null, { timeout: T });
    await apply();
    hh.chain = await chain();
    hh.span = await spanSecs();
    await undo();
    await page.waitForFunction(() => { const v = require("./state.js").getSession().annotations.external_videos || [];
      return v.length === 2 && v[1].out_ms == null; }, null, { timeout: 60000 });
    await apply();
    hh.undone = await chain();
  } catch (e) { hh.err = errText(e); }
  record("(h) the second video's end dragged on its band (the side lit under the pointer) to 0:40 trims it there, the timeline then running 40 s; Ctrl+Z gives it back",
    !hh.err && hh.hot && hh.chain && near(hh.chain[1][3], 40 - hh.chain[1][1], 0.6) && near(hh.span, 40, 0.8) &&
      hh.undone && hh.undone[1][3] === null, JSON.stringify(hh));

  // (i) Lane LANES ("every Timeline right-click marks there, on a band
  // too"): a right-click on the first video's band at 0:24 offers the
  // Timeline's own entries first, then the video's under its name; Add a
  // step here adds a step that starts there.
  let ii = {};
  try {
    await level("flow");
    await page.evaluate(() => document.querySelector("#timeline .tl-clip").scrollIntoView({ block: "nearest" }));
    const g = await geo();
    const before = (await anno()).steps.length;
    await page.mouse.click(xOf(g, atClick(24)), g.clipY, { button: "right" });
    await page.waitForSelector("#tl-ctx-menu", { timeout: T });
    ii.menu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu > *")].map((e) =>
      e.tagName === "HR" ? "|" : e.classList.contains("tl-ctx-head") ? "head: " + e.textContent : (e.textContent || "").trim()));
    await menuItem("Add a step here");
    await page.waitForFunction((n) => (require("./state.js").getSession().annotations.steps || []).length === n + 1, before, { timeout: T });
    const now = await anno();
    ii.starts = now.steps.filter((s) => s.time_range).map((s) => relOf(s.time_range.start));
    ii.count = [before, now.steps.length];
    await undo();
    await page.waitForFunction((n) => (require("./state.js").getSession().annotations.steps || []).length === n, before, { timeout: 60000 });
  } catch (e) { ii.err = errText(e); }
  const iMenu = ii.menu || [];
  const iRule = iMenu.indexOf("|"), iStep = iMenu.indexOf("Add a step here"), iTrim = iMenu.indexOf("Trim the start here");
  record("(i) lane LANES: a right-click on a video's band offers the Timeline's own entries first (Add a step here among them), then, under the video's name, its own entries (Trim the start here, Remove video); Add a step here adds a step that starts at 0:24",
    !ii.err && iStep >= 0 && iRule > iStep && /^head: pdt-e2e-synthetic-32s/.test(iMenu[iRule + 1] || "") && iTrim > iRule &&
      iMenu.includes("Remove video") && iMenu.indexOf("Start a transaction here…") === 0 &&
      ii.count[1] === ii.count[0] + 1 && ii.starts.some((s) => near(s, 24, 0.6)),
    JSON.stringify(ii));

  const pageErrs = errs.filter((x) => !/Failed to load resource|ERR_FILE_NOT_FOUND|Autofill/.test(x));
  record("zero page errors", pageErrs.length === 0, pageErrs.slice(0, 3).join(" | "));

  try { await app.close(); } catch (_) { /* closed */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* kept */ }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[video-chain-e2e] ${results.length - failed}/${results.length} checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
