/*
 * start-smoke.js: one start, and the notes in one paste (lanes B4 and E1),
 * in the real viewer.
 *
 *   (a) The page shown while no project is open: Open a zip... (the button
 *       and the Open menu's item), the drop line; a file dragged over the
 *       page shows it will take it (an outline and the line's own words); a
 *       drop the page cannot read says what it takes; a file dropped
 *       elsewhere, or a navigation to a file, never takes the window away.
 *   (b) Open a zip... on the capture app's zip (made with capture/
 *       zip-folder.js from a temp copy of sess-2026-0514-0900): one open
 *       dialog, one save dialog beside the zip named after the project
 *       folder in it; the status line while it unzips; the project opens
 *       for editing, is analyzed by itself, joins the recent projects, and
 *       nothing hidden is left beside it.
 *   (c) the same zip into the same folder again is refused in one sentence,
 *       and nothing is written.
 *   (d) a hand-off zip through the same entry still opens read only, with no
 *       Paste notes... in it.
 *   (e) New project from a video... with two videos and one transcript in
 *       one pick: the videos back to back in name order, the transcript
 *       bound to the video it shares its stem with and placed, the
 *       project on the Timeline.
 *   (f) the drop's door (window.__pdtOpenDropped, the function the page's
 *       drop listener calls: a real drag from Explorer cannot be driven):
 *       a folder that holds a recording, a zip, a video with its transcript,
 *       and a file the page does not take.
 *   (g) Paste notes...: the preview line as the text changes, twenty steps
 *       and three document fields from one paste in a project made from
 *       nothing, the first selected, one Ctrl+Z takes all of it back and
 *       Ctrl+Y brings it again; twenty steps from a paste in the video
 *       project and in the recording too.
 *   Zero page errors. Screenshots in e2e/ (start-*.png). Exits 0 when every
 *   check passed, 1 on a failed check, 2 when it could not run.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const { zipFolder } = require(path.join(REPO, "capture", "zip-folder.js"));
const HZ = require(path.join(VIEWER, "handoff-zip.js"));
const VIDEO_A = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");   // companion-smoke's, made here when absent
const VIDEO_B = path.join(os.tmpdir(), "pdt-e2e-synthetic-12s-v1.webm");   // video-chain-smoke's
const VTT = path.join(__dirname, "fixtures", "meeting-transcript.vtt");
const DEMO = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const SHOT_TAG = (process.env.PDT_E2E_WINDOW || "default").replace(/[^0-9x]/g, "") || "default";
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("start-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

/* A temp copy of the demo recording, as the capture app saved it. */
function freshRecording(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) fs.copyFileSync(path.join(DEMO, f), path.join(dest, f));
  fs.cpSync(path.join(DEMO, "screenshots"), path.join(dest, "screenshots"), { recursive: true });
  return dest;
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-start-"));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#btn-recent-menu", { timeout: T });
  } catch (e) { console.error("[start-e2e] FATAL:", e); process.exit(2); }
  const app = v.app;

  const shot = (name) => page.screenshot({ path: path.join(__dirname, "start-" + name + "-" + SHOT_TAG + ".png") }).catch((e) => console.log("shot fail", name, e.message));
  const session = () => page.evaluate(() => {
    const s = require("./state.js").getSession();
    return s ? { folder: s.sessionFolder, anno: s.annotations, readOnly: !!s.readOnly, analysis: !!s.analysis,
      transcripts: (s.transcripts || []).map((t) => t.file) } : null;
  });
  const settled = async () => {
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.stats && s.analysis) && !document.getElementById("run-status"); },
      null, { timeout: 120000 });
    await wait(300);
  };
  const opened = (folder) => page.waitForFunction((f) => {
    const s = require("./state.js").getSession();
    return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase();
  }, path.resolve(folder), { timeout: 60000 });
  const level = async (l) => { await page.locator('.view-mode-btn[data-level="' + l + '"]').click({ timeout: T }); await wait(300); };
  const toastText = () => page.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim());
  const activeLevel = () => page.evaluate(() => (document.querySelector(".view-mode-btn.active") || { dataset: {} }).dataset.level);
  /* The dialogs main shows, answered from `answers` ({ open: [...], save:
     [...] }, in order) and recorded in global.__asked. */
  const stubDialogs = (answers) => app.evaluate(({ dialog, shell }, a) => {
    global.__asked = [];
    const open = (a.open || []).slice(), save = (a.save || []).slice();
    dialog.showOpenDialog = async (_w, opts) => {
      const o = opts || _w;
      global.__asked.push({ kind: "open", title: o.title, properties: o.properties, filters: o.filters });
      const f = open.shift();
      return f ? { canceled: false, filePaths: [].concat(f) } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async (_w, opts) => {
      const o = opts || _w;
      global.__asked.push({ kind: "save", title: o.title, defaultPath: o.defaultPath, buttonLabel: o.buttonLabel });
      const f = save.shift();
      return f ? { canceled: false, filePath: f } : { canceled: true };
    };
    shell.showItemInFolder = () => {};
  }, answers);
  const asked = () => app.evaluate(() => global.__asked.slice());
  const openMenu = async (item) => { await page.click("#btn-recent-menu"); await page.click(item); };
  const newMenu = async (item) => { await page.click("#btn-new-menu"); await page.click(item); };

  // The synthetic videos (each frame showing its own time), made once, as
  // companion-smoke.js and video-chain-smoke.js make them.
  for (const [out, secs, colour] of [[VIDEO_A, 32, "#123"], [VIDEO_B, 12, "#512"]]) {
    if (fs.existsSync(out)) continue;
    await page.evaluate(async ({ out, secs, colour }) => {
      const cv = document.createElement("canvas");
      cv.width = 320; cv.height = 180;
      cv.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(cv);
      const gx = cv.getContext("2d");
      const rec = new MediaRecorder(cv.captureStream(10), { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      const t0 = performance.now();
      const draw = () => { gx.fillStyle = colour; gx.fillRect(0, 0, 320, 180); gx.fillStyle = "#fff"; gx.font = "28px monospace";
        gx.fillText("video " + ((performance.now() - t0) / 1000).toFixed(1), 20, 100); };
      draw();
      const iv = setInterval(draw, 100);
      rec.start(1000);
      await new Promise((r) => setTimeout(r, secs * 1000));
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      clearInterval(iv);
      cv.remove();
      require("fs").writeFileSync(out, Buffer.from(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
    }, { out, secs, colour });
  }
  const CALL = path.join(TMP, "call");
  fs.mkdirSync(CALL);
  const PART1 = path.join(CALL, "Order call part 1.webm"), PART2 = path.join(CALL, "Order call part 2.webm");
  const PART2_VTT = path.join(CALL, "Order call part 2 transcript.vtt");
  fs.copyFileSync(VIDEO_A, PART1);
  fs.copyFileSync(VIDEO_B, PART2);
  fs.copyFileSync(VTT, PART2_VTT);

  // ================= (a) the page shown while no project is open =================
  const a = {};
  try {
    a.page = await page.evaluate(() => {
      const txt = (id) => ((document.getElementById(id) || {}).textContent || "").trim();
      const line = document.getElementById("session-drop-line");
      return { hero: txt("btn-open-handoff-hero"), item: txt("btn-open-handoff"), line: txt("session-drop-line"),
        lineShown: !!line && line.checkVisibility(), heroTitle: document.getElementById("btn-open-handoff-hero").title };
    });
    await shot("page");
    // A file dragged over the page: the page shows it will take it.
    a.drag = await page.evaluate(() => {
      const el = document.getElementById("session-empty");
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "call.mp4", { type: "video/mp4" }));
      el.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
      const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(over);
      const st = getComputedStyle(el);
      return { ready: el.classList.contains("drop-ready"), line: document.getElementById("session-drop-line").textContent,
        outline: st.outlineStyle + " " + st.outlineColor, accepted: over.defaultPrevented, effect: dt.dropEffect };
    });
    await shot("drag-over");
    // A drop whose files have no path on disk (a File made in the page):
    // the listener reads it and says what the page takes.
    a.drop = await page.evaluate(async () => {
      const el = document.getElementById("session-empty");
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "call.mp4", { type: "video/mp4" }));
      const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      await new Promise((r) => setTimeout(r, 400));
      return { prevented: ev.defaultPrevented, ready: el.classList.contains("drop-ready"),
        line: document.getElementById("session-drop-line").textContent, toast: (document.getElementById("toast").textContent || "").trim() };
    });
    // A file dropped on the top bar is refused there; a navigation to a file
    // is held back by the main process.
    a.elsewhere = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "call.mp4", { type: "video/mp4" }));
      const over = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
      document.querySelector("header.topbar").dispatchEvent(over);
      const drop = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      document.querySelector("header.topbar").dispatchEvent(drop);
      return { effect: dt.dropEffect, prevented: drop.defaultPrevented, href: location.href };
    });
  } catch (e) { a.err = errText(e); }
  const DROP_TAKES = "This page takes a project folder, a zip, or a video with its transcript: drop one of them.";
  record("(a) the start page: Open a zip... (button and menu item) says what it takes; the drop line shows",
    !a.err && a.page.hero === "Open a zip..." && a.page.item === "Open a zip..." && a.page.lineShown &&
      a.page.line === "Or drop a project folder, a zip, or a video with its transcript here." &&
      a.page.heroTitle === "Open a zip: the SME's zip, a whole project, or a hand-off.", JSON.stringify(a.page || a.err));
  record("(a) files dragged over the page: an outline and the line saying Let go to open it here; the drop is accepted",
    !a.err && a.drag.ready && a.drag.line === "Let go to open it here." && /dashed/.test(a.drag.outline) && a.drag.accepted,
    JSON.stringify(a.drag));
  record("(a) a drop the page cannot read says what the page takes, and the page goes back to its line",
    !a.err && a.drop.prevented && !a.drop.ready && a.drop.toast.startsWith(DROP_TAKES) &&
      a.drop.line === "Or drop a project folder, a zip, or a video with its transcript here.", JSON.stringify(a.drop));
  record("(a) a file dropped elsewhere than the page is refused there",
    !a.err && a.elsewhere.effect === "none" && a.elsewhere.prevented, JSON.stringify(a.elsewhere));

  // ================= (b) the capture app's zip =================
  const REC = freshRecording(path.join(TMP, "sme", "20260514-090000"));
  const ZIP = (await zipFolder(REC, path.join(TMP, "sme", "Order entry.zip"))).zipPath;
  fs.rmSync(REC, { recursive: true, force: true });
  const OUT = path.join(TMP, "projects", "Order entry");
  const b = {};
  try {
    await stubDialogs({ open: [ZIP], save: [OUT] });
    await page.evaluate(() => {
      window.__unzipSeen = [];
      const host = document.getElementById("unzip-status");
      new MutationObserver(() => { if (!host.hidden) window.__unzipSeen.push(host.textContent.trim()); })
        .observe(host, { attributes: true, childList: true, subtree: true, characterData: true });
    });
    await openMenu("#btn-open-handoff");
    await opened(OUT);
    await settled();
    b.asked = await asked();
    b.s = await session();
    b.seen = await page.evaluate(() => window.__unzipSeen.slice());
    b.status = await page.evaluate(() => document.getElementById("unzip-status").hidden);
    b.recent = await page.evaluate(() => require("./recent.js").getRecent().map((r) => r.folder));
    b.beside = fs.readdirSync(path.dirname(OUT));
    b.steps = (b.s.anno.steps || []).length;
  } catch (e) { b.err = errText(e); }
  record("(b) Open a zip... on the capture app's zip: one open dialog for a zip, one save dialog beside it named after the zip",
    !b.err && b.asked.length === 2 && b.asked[0].kind === "open" && b.asked[0].title === "Open a zip" &&
      JSON.stringify(b.asked[0].filters) === JSON.stringify([{ name: "Zip", extensions: ["zip"] }]) &&
      b.asked[1].kind === "save" && path.resolve(b.asked[1].defaultPath) === path.join(path.dirname(ZIP), "Order entry"),
    JSON.stringify(b.asked || b.err));
  record("(b) the unzipping shows its status line with Cancel, then the line goes",
    !b.err && b.seen.some((t) => /^Unzipping the project/.test(t) && /Cancel$/.test(t)) && b.status === true, JSON.stringify(b.seen));
  record("(b) the project opens for editing, analyzed by itself, joins the recent projects, and nothing hidden is left beside it",
    !b.err && !b.s.readOnly && b.s.analysis && b.steps > 0 && fs.existsSync(path.join(OUT, "events.jsonl")) &&
      fs.existsSync(path.join(OUT, "screenshots")) && b.recent.some((f) => path.resolve(f) === path.resolve(OUT)) &&
      JSON.stringify(b.beside) === JSON.stringify(["Order entry"]),
    JSON.stringify({ steps: b.steps, beside: b.beside, readOnly: b.s && b.s.readOnly, err: b.err }));
  await shot("zip-opened");

  // ================= (c) into a folder that is there and not empty =================
  const c = {};
  try {
    await stubDialogs({ open: [ZIP], save: [OUT] });
    const before = fs.readdirSync(OUT).sort();
    await openMenu("#btn-open-handoff");
    await page.waitForFunction(() => /did not open/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    c.toast = await toastText();
    c.same = JSON.stringify(fs.readdirSync(OUT).sort()) === JSON.stringify(before);
    c.beside = fs.readdirSync(path.dirname(OUT));
    c.s = await session();
  } catch (e) { c.err = errText(e); }
  record("(c) the same zip into the same folder is refused in one sentence, and nothing is written",
    !c.err && c.toast.startsWith("The zip did not open: a folder of that name is there and it is not empty (" + OUT + ").") && c.same &&
      JSON.stringify(c.beside) === JSON.stringify(["Order entry"]) && path.resolve(c.s.folder) === path.resolve(OUT), JSON.stringify(c));

  // ================= (g, recording) twenty steps pasted in the recording =================
  const TWENTY = Array.from({ length: 20 }, (_, i) => (i % 2 ? "- " : (i + 1) + ". ") + "Pasted step " + (i + 1) + (i % 3 ? ": detail " + (i + 1) : "")).join("\r\n");
  const pasteAndCount = async (text) => {
    await level("steps");
    const before = await page.evaluate(() => (require("./state.js").getSession().annotations.steps || []).filter((s) => s.state === "manually_authored").length);
    await page.click("#btn-paste-notes");
    await page.waitForSelector(".modal-prompt .modal-textarea", { timeout: T });
    await page.fill(".modal-prompt .modal-textarea", text);
    await page.click(".modal-prompt .modal-ok");
    await page.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
    await wait(600);
    const after = await page.evaluate(() => (require("./state.js").getSession().annotations.steps || []).filter((s) => s.state === "manually_authored").length);
    return after - before;
  };
  const gr = {};
  try { gr.added = await pasteAndCount(TWENTY); } catch (e) { gr.err = errText(e); }
  record("(g) in a recording, twenty lines pasted are twenty steps", !gr.err && gr.added === 20, JSON.stringify(gr));

  // ================= (d) a hand-off zip through the same entry =================
  const d = {};
  try {
    const H = path.join(TMP, "handoff-src", "Order entry");
    freshRecording(H);
    const anno = readJson(path.join(H, "annotations.json"));
    const entry = { version: 1, handed_off_at: "2026-11-10T09:00:00.000Z", by: "e2e", note: "First hand-off" };
    anno.handoffs = [entry];
    fs.writeFileSync(path.join(H, "annotations.json"), JSON.stringify(anno, null, 2));
    const pdd = path.join(TMP, "fake.docx");
    fs.writeFileSync(pdd, "PK fake");
    const hz = await HZ.writeHandoffZip(H, { base: "Order entry", version: 1, pdd, entry });
    await stubDialogs({ open: [hz.zipPath], save: [] });
    await openMenu("#btn-open-handoff");
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.readOnly); }, null, { timeout: 60000 });
    d.asked = await asked();
    d.s = await session();
    d.userData = await app.evaluate(({ app: a2 }) => a2.getPath("userData"));
    await level("steps");
    d.paste = await page.evaluate(() => document.getElementById("btn-paste-notes").checkVisibility());
  } catch (e) { d.err = errText(e); }
  record("(d) a hand-off zip through Open a zip... opens read only as before (no save dialog), with no Paste notes...",
    !d.err && d.s.readOnly && d.asked.length === 1 && d.asked[0].title === "Open a zip" &&
      d.s.folder.startsWith(path.join(d.userData, "handoffs") + path.sep) && d.paste === false, JSON.stringify(d.err || { asked: d.asked, folder: d.s.folder, paste: d.paste }));

  // ================= (e) two videos and a transcript in one pick =================
  const CALLP = path.join(TMP, "projects", "Order call");
  const e = {};
  try {
    await stubDialogs({ open: [[PART2_VTT, PART2, PART1]], save: [CALLP] });
    await newMenu("#btn-new-from-video");
    await opened(CALLP);
    await settled();
    await wait(800);
    e.asked = await asked();
    e.s = await session();
    e.level = await activeLevel();
    e.clips = e.s.anno.external_videos;
    e.tr = readJson(path.join(CALLP, "transcript.json"));
    e.parts = await page.evaluate(() => require("./transcript-model.js").partsOf(require("./state.js").getSession())
      .map((p) => ({ file: p.file, videoId: p.videoId, synced: p.synced, offsetMs: p.offsetMs, n: p.sentences.length })));
    await shot("video-project");
  } catch (err) { e.err = errText(err); }
  record("(e) one pick of videos and transcripts: the dialog takes several files, videos and transcripts together",
    !e.err && e.asked.length === 2 && e.asked[0].properties.includes("multiSelections") &&
      e.asked[0].filters[0].extensions.includes("vtt") && e.asked[0].filters[0].extensions.includes("webm") &&
      path.basename(e.asked[1].defaultPath) === "Order call part 1", JSON.stringify(e.asked || e.err));
  record("(e) the videos back to back in name order, the transcript bound to part 2 (its stem) and placed, the project on the Timeline",
    !e.err && e.clips.length === 2 && e.clips[0].path === "video/Order call part 1.webm" && e.clips[0].offset_ms === 0 &&
      e.clips[1].path === "video/Order call part 2.webm" && Math.abs(e.clips[1].offset_ms - e.clips[0].length_ms) < 2 &&
      e.clips[0].length_ms > 25000 && e.tr.video_id === "v2" && e.parts.length === 1 && e.parts[0].synced &&
      e.parts[0].offsetMs === e.clips[1].offset_ms && e.parts[0].n > 0 && e.level === "flow",
    JSON.stringify(e.err || { clips: e.clips, parts: e.parts, level: e.level }));
  const gv = {};
  try { gv.added = await pasteAndCount(TWENTY); } catch (err) { gv.err = errText(err); }
  record("(g) in a project made from a video, twenty lines pasted are twenty steps", !gv.err && gv.added === 20, JSON.stringify(gv));

  // ================= (f) the drop's door =================
  const f = {};
  try {
    // A folder that holds a recording (what Extract All makes): the recording opens.
    const outer = path.join(TMP, "dropped", "Order entry unzipped");
    freshRecording(path.join(outer, "20260514-090000"));
    f.folder = await page.evaluate((p) => window.__pdtOpenDropped([p]), outer);
    await opened(path.join(outer, "20260514-090000"));
    await settled();
    // A zip: as Open a zip..., from its save dialog on.
    const OUT2 = path.join(TMP, "dropped", "From the drop");
    await stubDialogs({ open: [], save: [OUT2] });
    f.zip = await page.evaluate((p) => window.__pdtOpenDropped([p]), ZIP);
    await opened(OUT2);
    f.zipAsked = await asked();
    f.zipRo = (await session()).readOnly;
    // A video with its transcript: as New project from a video..., from the name dialog on.
    const VP = path.join(TMP, "dropped", "Dropped call");
    const one = path.join(TMP, "dropped", "Dropped call.webm"), oneVtt = path.join(TMP, "dropped", "Dropped call.vtt");
    fs.copyFileSync(VIDEO_B, one);
    fs.copyFileSync(VTT, oneVtt);
    await stubDialogs({ open: [], save: [VP] });
    f.video = await page.evaluate((ps) => window.__pdtOpenDropped(ps), [oneVtt, one]);
    await opened(VP);
    await wait(800);
    f.videoAsked = await asked();
    f.videoLevel = await activeLevel();
    f.videoTr = fs.existsSync(path.join(VP, "transcript.json")) ? readJson(path.join(VP, "transcript.json")).video_id : null;
    // Anything else.
    f.other = await page.evaluate((p) => window.__pdtOpenDropped([p]), VTT);
    f.otherToast = await toastText();
  } catch (err) { f.err = errText(err); }
  record("(f) dropped: a folder holding a recording opens it, a zip unzips after one save dialog, a video with its transcript makes a project on the Timeline after its name dialog",
    !f.err && f.folder === "folder" && f.zip === "zip" && f.zipAsked.length === 1 && f.zipAsked[0].kind === "save" && f.zipRo === false &&
      f.video === "videos" && f.videoAsked.length === 1 && f.videoAsked[0].kind === "save" && f.videoLevel === "flow" && f.videoTr === "v1",
    JSON.stringify(f));
  record("(f) a dropped transcript alone says it goes with its video", !f.err && f.other === "none" && /drop the video with it/.test(f.otherToast), f.otherToast);

  // ================= (g) Paste notes... in a project made from nothing =================
  const BLANK = path.join(TMP, "projects", "Notes only");
  const g = {};
  const NOTES = Array.from({ length: 20 }, (_, i) => (i + 1) + ". Step of the call " + (i + 1) + (i === 0 ? ": from the shared inbox" : "")).join("\n") +
    "\n   - check the sender\nTrigger: an order mail arrives\nResult: the order is in SAP\nVolume: 40 orders a day\n";
  try {
    await stubDialogs({ open: [], save: [BLANK] });
    await newMenu("#btn-new-blank");
    await opened(BLANK);
    await settled();
    await level("steps");
    g.empty = await page.evaluate(() => ((document.querySelector("#step-list .run-empty, #step-list .empty-pane, #step-list") || {}).textContent || "").replace(/\s+/g, " ").trim());
    await shot("steps-empty");
    await page.click("#btn-paste-notes");
    await page.waitForSelector(".modal-prompt .modal-textarea", { timeout: T });
    // The dialog takes the focus a tick after it is drawn (modals.js), so wait for it.
    g.focused = await page.waitForFunction(() => !!document.activeElement && document.activeElement.classList.contains("modal-textarea"), null, { timeout: 3000 }).then(() => true, () => false);
    g.preview0 = await page.evaluate(() => ({ text: document.querySelector(".modal-preview").textContent, ok: !document.querySelector(".modal-prompt .modal-ok").disabled }));
    await page.fill(".modal-prompt .modal-textarea", "Open SAP");
    g.preview1 = await page.evaluate(() => document.querySelector(".modal-preview").textContent);
    await page.fill(".modal-prompt .modal-textarea", NOTES);
    g.preview2 = await page.evaluate(() => ({ text: document.querySelector(".modal-preview").textContent, ok: !document.querySelector(".modal-prompt .modal-ok").disabled }));
    await shot("paste-dialog");
    await page.click(".modal-prompt .modal-ok");
    await page.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
    await wait(800);
    const disk = () => readJson(path.join(BLANK, "annotations.json"));
    const s1 = disk();
    g.steps = (s1.steps || []).filter((x) => x.state === "manually_authored");
    g.doc = s1.document || {};
    g.selected = await page.evaluate(() => require("./state.js").getSelectedStepId());
    g.toast = await toastText();
    await shot("pasted");
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press("Control+Z");
    await wait(1000);
    const s2 = disk();
    g.undone = { steps: (s2.steps || []).length, trigger: (s2.document || {}).trigger || "" };
    await page.keyboard.press("Control+Y");
    await wait(1000);
    const s3 = disk();
    g.redone = { steps: (s3.steps || []).length, trigger: (s3.document || {}).trigger || "" };
    await level("overview");
    g.ovTrigger = await page.evaluate(() => { const el = document.querySelector('[data-doc="trigger"]'); return el ? el.value : null; });
  } catch (err) { g.err = errText(err); }
  record("(g) the empty Steps page of a project made from nothing names + Add step and Paste notes...",
    !g.err && /\+ Add step adds one, and Paste notes\.\.\. adds one for each line of your notes\./.test(g.empty), g.empty || g.err);
  record("(g) Paste notes... opens on its box with the keyboard in it; the line under it says what it will make as the text changes",
    !g.err && g.focused && g.preview0.text === "Nothing to add yet" && !g.preview0.ok && g.preview1 === "1 step" &&
      g.preview2.text === "20 steps and 3 document fields: Trigger, Result, Volume and effort" && g.preview2.ok,
    JSON.stringify({ p0: g.preview0, p1: g.preview1, p2: g.preview2, err: g.err }));
  record("(g) OK makes twenty steps added by hand in the order pasted (no time, an order), the indented line in the last one's description, three field texts; the first step is selected",
    !g.err && g.steps.length === 20 && g.steps.every((x) => x.time_range === null && Number.isFinite(x.order)) &&
      g.steps.slice().sort((x, y) => x.order - y.order).map((x) => x.name).join("|") === Array.from({ length: 20 }, (_, i) => "Step of the call " + (i + 1)).join("|") &&
      g.steps.find((x) => x.name === "Step of the call 1").description === "from the shared inbox" &&
      g.steps.find((x) => x.name === "Step of the call 20").description === "check the sender" &&
      g.doc.trigger === "an order mail arrives" && g.doc.result === "the order is in SAP" && g.doc.effort === "40 orders a day" &&
      g.selected === g.steps.slice().sort((x, y) => x.order - y.order)[0].step_id && /Ctrl\+Z takes it all back/.test(g.toast),
    JSON.stringify(g.err || { n: g.steps.length, doc: g.doc, toast: g.toast, selected: g.selected,
      steps: g.steps.map((x) => [x.name, x.order, x.time_range, x.description, x.step_id]) }));
  record("(g) one Ctrl+Z takes every step and every field text back; Ctrl+Y brings them again, and the Overview shows the field",
    !g.err && g.undone.steps === 0 && g.undone.trigger === "" && g.redone.steps === 20 && g.redone.trigger === "an order mail arrives" &&
      g.ovTrigger === "an order mail arrives", JSON.stringify({ undone: g.undone, redone: g.redone, ov: g.ovTrigger }));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));

  // Last, as a navigation held back leaves Playwright waiting on the page:
  // the window asked to load a file (what a dropped file does) stays on its
  // own page (main.js will-navigate).
  const n = {};
  try {
    n.before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL());
    page.evaluate((p) => { location.href = require("url").pathToFileURL(p).href; }, PART1).catch(() => {});
    await wait(2000);
    n.after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL());
  } catch (err) { n.err = errText(err); }
  record("(a) a navigation to a dropped file never takes the window away from its page",
    !n.err && /index\.html$/.test(n.before) && n.after === n.before, JSON.stringify(n));
  await v.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[start-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[start-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
