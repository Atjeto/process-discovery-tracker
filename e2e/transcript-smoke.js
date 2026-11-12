"use strict";
/*
 * Transcript e2e smoke (BA helper cycle, lane L11b; contract C8, plan
 * section 7).
 *
 * Launches the REAL viewer on a throwaway profile (launchViewer) against a
 * TEMP copy of the committed demo session sess-2026-0514-0900, analyzed with
 * the current pipeline (4 runs from 09:00:19 to 09:05:15), and attaches the
 * synthetic fixture fixtures/meeting-transcript.vtt: 10 invented sentences by
 * "SME" and "Analyst" of a call that starts 30 s before the recording. Once
 * synced, 2 sentences fall before the recording, 1 before the first run, 2 in
 * run 1, 2 between runs 1 and 2, 1 in run 2, 1 after the last run and 1 after
 * the recording. The main-process open dialog is replaced (as overview-smoke
 * replaces the save dialog). Checks:
 *   (a) before an import the only transcript UI is Attach on the Overview's
 *       project line (the "More" menu is gone, lane V1);
 *   (b) Attach transcript writes transcript.json and the copied original;
 *   (c) the not-synced state of the Timeline lane (named Transcript at the
 *       timeline's left; its label carries Sync, Replace and Remove), the
 *       step editor and the Overview;
 *   (d) Sync (pick a sentence, click its moment on the timeline) writes
 *       offset_ms and the lane then draws the sentences said while recording;
 *   (e) the step editor lists the sentences of a step's window, Add fills the
 *       Description (empty, the draft's narration only its hint) and saves it
 *       in annotations.json, and the button then reads Added; a step with no
 *       talk says so; the step panel's row shows the sentences under a
 *       "Said:" lead;
 *   (f) the Overview lists the talk outside the transactions by default and
 *       says so in its title line ("What was said outside the transactions",
 *       AD-29); a sentence said before the recording reads "m:ss before",
 *       never a negative time; the speaker filter, the search and "Include
 *       talk during the transactions" narrow and widen it; Add to Business
 *       rules lands in document.business_rules;
 *   (g) an unsupported file fails with the import's message and the previous
 *       transcript stays;
 *   (i) the pulled sentences reach the exported PDD (word/document.xml);
 *   (h) Remove transcript takes out transcript.json and its original (lane
 *       CC), every transcript surface is gone, and Ctrl+Z brings both files
 *       back (Ctrl+Y takes them out again);
 *   (j) a transcript.json that cannot be read is said once, in a toast, and
 *       Remove transcript clears it;
 *   and zero page errors.
 *
 * Writes only into its temp folders and its throwaway profile. Exits 0 when
 * every check passed, 1 on a failed check, 2 when it could not run (no Python
 * with the pipeline dependencies, or no Electron).
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const FIXTURE = path.join(__dirname, "fixtures", "meeting-transcript.vtt");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}
const errText = (e) => { logActionError("transcript-smoke", e); return String((e && e.message) || e).split("\n")[0]; };

/* The demo, copied to temp and analyzed with the current pipeline. */
function freshSession() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-transcript-"));
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) {
    const s = path.join(SRC_SESSION, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
  }
  const bundled = path.join(VIEWER, "python", "python.exe");
  const pys = fs.existsSync(bundled) ? [bundled] : ["python", "python3"];
  for (const py of pys) {
    try {
      execFileSync(py, [path.join(REPO, "normalization", "normalize.py"), tmp, "--mine"], { cwd: REPO, stdio: "ignore" });
      return tmp;
    } catch (_) { /* try the next interpreter */ }
  }
  return null;
}

/* The one file a zip (a .docx) holds under `name`, as text. */
function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("not a zip: bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

const SESSION = freshSession();
if (!SESSION) {
  console.log("[transcript-e2e] FATAL: no Python with the pipeline dependencies to analyze the demo");
  process.exit(2);
}
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-transcript-files-"));
const BAD = path.join(FILES, "call-notes.vtt");
fs.writeFileSync(BAD, "These are my notes from the call, not a transcript.\n");
const ANNO = path.join(SESSION, "annotations.json");
const TRANSCRIPT = path.join(SESSION, "transcript.json");
const COPY = path.join(SESSION, "transcript", "meeting-transcript.vtt");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

async function waitDisk(p, pred, ms) {
  const deadline = Date.now() + (ms || T);
  let last = null;
  while (Date.now() < deadline) {
    try { last = readJson(p); if (pred(last)) return last; } catch (_) { last = null; }
    await wait(150);
  }
  return last;
}

/* The fixture's sentences, by the ids the import gives them. */
const S = {
  t0001: "Thanks for joining, let us walk through how an order gets entered.",
  t0002: "We enter every order on the day it arrives by email.",
  t0003: "Orders from the web portal are out of scope, another team handles those.",
  t0004: "Now I search for the customer account.",
  t0005: "The order number goes into the reference field before I save.",
  t0006: "What happens when the order total is very large?",
  t0007: "Anything over ten thousand needs a manager to approve it first.",
  t0008: "I check the plant code in my notes file.",
  t0009: "That covers the normal case, thank you.",
  t0010: "Send me the document when it is ready.",
};
const NOT_SYNCED = "The transcript is not synced to the recording yet. Sync it on the Timeline.";
// t0004 starts 50 s into the call; the smoke places it at 09:00:20.
const SYNC_AT = "2026-05-14T09:00:20Z";
const WANT_OFFSET = -30000;

/* ---- Lane E: the transcript beside the video (E3) and the Overview's list
   with one unmarked transaction (E6) -------------------------------------------
   A project made from the synthetic video (32 s; companion-smoke's, made here
   when absent) with a transcript of 15 invented sentences by three speakers
   placed from the video's start and three steps written first, opened in a
   second viewer:
     (k) E6: the Overview's "From the transcript" lists all 15 sentences,
         says "Everything that was said", and offers no "Include talk during
         the transactions";
     (l) E3: the Transcript tab: the sentences on the one clock, the speaker
         where it changes; typing "invoice" counts "3 of 15" and marks the
         matches; the speaker select narrows to Tom; a click on a sentence
         puts the clock there and a paused video stays paused; the sentence
         at the playhead is marked, and moves with the playhead while the
         video plays, a class moved on the same rows (the list not built
         again);
     (m) a sentence's two acts, Add step here and Copy to..., shown on the
         row under the pointer, the focused row and the playhead's row, and
         transparent elsewhere without changing a row's height: Add step
         here, by the keyboard, adds a step at its moment with the video's
         frame, the tab staying open; Copy to... opens one menu, "Copy this
         sentence to": the selected step's description, then the document's
         fields (Exceptions); with no step selected the description item
         says to select one and does nothing;
     (n) a stretch put aside: its sentences are not listed, one row says
         "Not part of the process: 0:08 to 0:16" with Include again, which
         brings them back; read only, reading and searching work and no act
         is offered;
     (o) lane W2: the speed at 2x runs the clock about twice as fast as real
         time; the caption under the video shows each sentence as it is said
         (the speaker in bold, 14 px, two lines at most) and nothing between
         two sentences, keeping its height; the video, the caption and the
         row do not overlap; a click on the caption opens the Transcript tab
         at its sentence; I at 0:05 and O at 0:12 while the video plays
         select "0:05 to 0:12 · 7s" with its acts, the video playing on and
         nothing asked; I and O at one moment say why, Escape clears the
         start. */
const LANE_E_VIDEO = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");
const LANE_E_LINES = [
  [1, "Maria Keller", "So this is how an order comes in."], [3, "Maria Keller", "I open the shared mailbox first."],
  [5, "Analyst", "Which mailbox is that?"], [7, "Maria Keller", "Orders at the company address."],
  [9, "Tom", "By the way, did you see the game last night?"], [11, "Analyst", "No, I missed it."],
  [13, "Tom", "It went to extra time."], [15, "Tom", "Lunch is at noon today."], [17, "Maria Keller", "Right, back to the order."],
  [19, "Maria Keller", "Then I check the stock in SAP."], [22, "Analyst", "And if it is out of stock?"],
  [24, "Maria Keller", "Then I tell the customer."], [26, "Maria Keller", "Last, I send the invoice by mail."],
  [28, "Analyst", "Who checks the invoice?"], [30, "Maria Keller", "Nobody, the invoice goes out at once."],
];
const LANE_E_T0 = Date.parse("2026-11-10T09:00:00.000Z");

function laneEProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-transcript-lanee-"));
  fs.mkdirSync(path.join(dir, "video"));
  fs.copyFileSync(LANE_E_VIDEO, path.join(dir, "video", "call.webm"));
  const started = new Date(LANE_E_T0).toISOString();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: "lane-e-tr", source: "video", started_at: started, label: "Order call" }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const hand = (id, name, order) => ({ step_id: id, name, state: "manually_authored", case_id: null, time_range: null, order,
    description: "", evidence: { interaction_event_ids: [], screenshot_refs: [] }, flags: { waste: false } });
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify({ version: 1, session_id: "lane-e-tr",
    steps: [hand("n1", "Open the order", 1), hand("n2", "Check the stock", 2), hand("n3", "Send the invoice", 3)],
    external_videos: [{ id: "v1", path: "video/call.webm", offset_ms: 0, in_ms: 0, out_ms: null, attached_at: started }] }, null, 2));
  fs.writeFileSync(path.join(dir, "transcript.json"), JSON.stringify({ version: 1, video_id: "v1", offset_ms: 0,
    segments: LANE_E_LINES.map(([s, sp, t], i) => ({ id: "t" + (i + 1), start_s: s, end_s: s + 1.6, speaker: sp, text: t })) }));
  return dir;
}

async function laneE() {
  let v, page;
  const errs = [];
  let dir = null;
  try {
    if (!fs.existsSync(LANE_E_VIDEO)) {
      // Made as companion-smoke makes it: 32 s of a canvas, the time on it.
      const maker = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
      const p = await maker.app.firstWindow();
      await p.waitForSelector("#btn-recent-menu", { timeout: T });
      await p.evaluate(async (out) => {
        const cv = document.createElement("canvas");
        cv.width = 320; cv.height = 180;
        cv.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(cv);
        const gx = cv.getContext("2d");
        const rec = new MediaRecorder(cv.captureStream(10), { mimeType: "video/webm;codecs=vp8" });
        const chunks = [];
        rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
        const t0 = performance.now();
        const draw = () => { gx.fillStyle = "#123"; gx.fillRect(0, 0, 320, 180); gx.fillStyle = "#fff"; gx.font = "28px monospace";
          gx.fillText("video " + ((performance.now() - t0) / 1000).toFixed(1), 20, 100); };
        draw();
        const iv = setInterval(draw, 100);
        rec.start(1000);
        await new Promise((r) => setTimeout(r, 32000));
        await new Promise((r) => { rec.onstop = r; rec.stop(); });
        clearInterval(iv);
        cv.remove();
        require("fs").writeFileSync(out, Buffer.from(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
      }, LANE_E_VIDEO);
      await maker.close();
    }
    dir = laneEProject();
    v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + dir], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.stats) && !require("./views/flow-view.js").analysisBusy(); }, null, { timeout: 60000 });
  } catch (e) {
    record("lane E: the project made from a video, with a transcript, opens", false, errText(e));
    if (v) await v.close();
    return;
  }
  const anno = () => page.evaluate(() => require("./state.js").getSession().annotations);
  const at = () => page.evaluate(() => require("./views/flow-view-video.js").playheadMs());
  const sec = (ms) => Math.round((ms - LANE_E_T0) / 100) / 10;

  // (k) E6.
  {
    let k = null, err = null;
    try {
      await page.click('.view-mode-btn[data-level="overview"]');
      k = await page.evaluate(() => {
        const d = document.getElementById("ov-doc"); if (d) d.open = true;
        const t = document.getElementById("ov-tr"); if (t) t.open = true;
        return { count: (document.getElementById("ov-tr-count") || {}).textContent, what: (document.getElementById("ov-tr-what") || {}).textContent,
          rows: document.querySelectorAll("#ov-tr-list .tr-row").length, during: !!document.querySelector(".ov-tr-during-cb") };
      });
    } catch (e) { err = errText(e); }
    record("(k) lane E, E6: with its one transaction not marked, the Overview's From the transcript lists all 15 sentences, says \"Everything that was said\" and offers no \"Include talk during the transactions\"",
      !err && k.count === "(15)" && k.rows === 15 && k.what === "Everything that was said" && !k.during, JSON.stringify({ err, k }));
  }

  // (l) E3: the tab, its search, its speaker, a click, the marked sentence.
  {
    let l = {}, err = null;
    try {
      await page.click('.view-mode-btn[data-level="flow"]');
      await page.waitForFunction(() => !!require("./views/flow-view-video.js").timelineSpan(), null, { timeout: T });
      await page.click('.anno-tab[data-anno="transcript"]');
      await page.waitForSelector(".trt-list .trt-row", { timeout: T });
      l.list = await page.evaluate(() => ({ rows: document.querySelectorAll(".trt-row").length,
        first: [...document.querySelectorAll(".trt-row")].slice(0, 3).map((r) => r.querySelector(".tr-time").textContent + "|" +
          ([...r.querySelectorAll(".tr-speaker")].filter((x) => x.checkVisibility()).map((x) => x.textContent).join("")) + "|" + r.querySelector(".tr-text").textContent),
        count: document.querySelector(".trt-count").textContent }));
      await page.fill(".trt-search", "invoice");
      l.search = await page.evaluate(() => ({ count: document.querySelector(".trt-count").textContent, marks: document.querySelectorAll(".trt-list mark").length,
        shown: [...document.querySelectorAll(".trt-row")].filter((r) => !r.hidden).length }));
      await page.locator(".trt-row:not([hidden]) .trt-say").first().click();
      await wait(700);
      l.click = { at: sec(await at()), paused: await page.evaluate(() => document.getElementById("video").paused),
        current: await page.evaluate(() => (document.querySelector(".trt-row.current .tr-text") || {}).textContent) };
      await page.fill(".trt-search", "");
      await page.selectOption(".trt-speaker", "Tom");
      l.tom = await page.evaluate(() => ({ count: document.querySelector(".trt-count").textContent,
        speakers: [...new Set([...document.querySelectorAll(".trt-row")].filter((r) => !r.hidden).map((r) => r.querySelector(".tr-speaker").textContent))] }));
      await page.selectOption(".trt-speaker", "");
      // The playhead's sentence while playing: from 0:01.5, the marked row
      // moves from the first sentence on, the rows being the same elements.
      await page.mouse.move(5, 5);
      await page.evaluate((t) => require("./views/flow-view-video.js").seekClock(t, false), LANE_E_T0 + 1500);
      await wait(500);
      l.before = await page.evaluate(() => { const r = document.querySelector(".trt-row.current"); if (r) r.dataset.probe = "kept"; return r ? r.querySelector(".tr-text").textContent : null; });
      await page.evaluate(() => document.getElementById("video").play());
      await page.waitForFunction(() => require("./views/flow-view-video.js").playheadMs() > Date.parse("2026-11-10T09:00:03.300Z"), null, { timeout: T });
      await page.evaluate(() => document.getElementById("video").pause());
      l.after = await page.evaluate(() => ({ text: (document.querySelector(".trt-row.current .tr-text") || {}).textContent,
        kept: !!document.querySelector('.trt-row[data-probe="kept"]'), currents: document.querySelectorAll(".trt-row.current").length }));
    } catch (e) { err = errText(e); }
    const ok = !err && l.list.rows === 15 && l.list.count === "15 sentences" &&
      l.list.first[0] === "0:01|Maria Keller|So this is how an order comes in." && l.list.first[1] === "0:03||I open the shared mailbox first." &&
      l.list.first[2] === "0:05|Analyst|Which mailbox is that?" &&
      l.search.count === "3 of 15" && l.search.marks === 3 && l.search.shown === 3 &&
      l.click.at === 26 && l.click.paused && l.click.current === "Last, I send the invoice by mail." &&
      l.tom.count === "3 of 15" && JSON.stringify(l.tom.speakers) === '["Tom"]' &&
      l.before === "So this is how an order comes in." && l.after.text === "I open the shared mailbox first." && l.after.kept && l.after.currents === 1;
    record("(l) lane E, E3: the Transcript tab lists the sentences on the one clock with the speaker where it changes; \"invoice\" counts 3 of 15 and marks the matches; the speaker select narrows to Tom; a click puts the clock at the sentence, the paused video staying paused; the sentence at the playhead is marked and moves while the video plays, the list not built again",
      ok, JSON.stringify({ err, l }));
    if (!ok) await shot(page, "fail-transcript-lanee-tab.png");
  }

  // (m) the three acts.
  {
    let m = {}, err = null;
    try {
      // The acts: transparent on a row that is neither under the pointer,
      // nor holds the keyboard, nor is the playhead's; shown on those; the
      // row never changes height.
      await page.mouse.move(5, 5);
      const row = page.locator(".trt-row", { hasText: "check the stock" });
      m.look = await page.evaluate(() => {
        const r = [...document.querySelectorAll(".trt-row")].find((x) => /check the stock/.test(x.textContent));
        const acts = r.querySelector(".trt-acts");
        const cur = document.querySelector(".trt-row.current .trt-acts");
        return { labels: [...acts.querySelectorAll("button")].map((b) => b.textContent + "|" + b.title),
          idle: getComputedStyle(acts).opacity, current: cur ? getComputedStyle(cur).opacity : null, h: r.offsetHeight,
          display: getComputedStyle(acts).display };
      });
      await row.locator(".trt-copy").focus();
      m.look.focused = await page.evaluate(() => {
        const r = document.activeElement.closest(".trt-row");
        return { opacity: getComputedStyle(r.querySelector(".trt-acts")).opacity, h: r.offsetHeight };
      });
      await row.locator(".trt-add-step").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => require("./state.js").getSession().annotations.steps.length === 4, null, { timeout: T });
      const a = await anno();
      const added = a.steps.find((s) => !["n1", "n2", "n3"].includes(s.step_id));
      m.added = { at: sec(Date.parse(added.time_range.start)), shot: (a.analyst_screenshots || []).some((x) => x.step_id === added.step_id && x.source === "video_frame"),
        tab: await page.evaluate(() => document.querySelector(".anno-tab.active").dataset.anno),
        // Lane PANE: the step added opens in place in the pane's Steps tab.
        opened: await page.evaluate(() => (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId || null) };
      m.added.inPane = m.added.opened === added.step_id;
      await page.locator("#tp-tab-transcript").click();
      await page.evaluate((id) => require("./state.js").setSelectedStepId(id), added.step_id);
      const row2 = page.locator(".trt-row", { hasText: "out of stock" });
      // Copy to... by the keyboard: one menu, its heading, the step's
      // description first (focused), then the document's fields.
      await row2.locator(".trt-copy").focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#ov-tr-add-menu", { timeout: T });
      m.menu = await page.evaluate(() => ({ head: (document.querySelector("#ov-tr-add-menu .tr-add-menu-head") || {}).textContent,
        items: [...document.querySelectorAll("#ov-tr-add-menu .project-menu-item")].map((b) => b.textContent),
        focus: document.activeElement && document.activeElement.textContent }));
      await page.keyboard.press("Enter");
      await page.waitForFunction((id) => /out of stock/.test(require("./state.js").getSession().annotations.steps.find((s) => s.step_id === id).description || ""), added.step_id, { timeout: T });
      m.desc = true;
      await row2.locator(".trt-copy").click();
      await page.locator('#ov-tr-add-menu [data-doc-target="exceptions"]').click();
      await page.waitForFunction(() => /out of stock/.test(((require("./state.js").getSession().annotations.document) || {}).exceptions || ""), null, { timeout: T });
      m.doc = true;
      await page.evaluate(() => require("./state.js").setSelectedStepId(null));
      await row2.locator(".trt-copy").click();
      m.offItem = await page.evaluate(() => { const b = document.querySelector("#ov-tr-add-menu [data-first]"); return b && [b.textContent, b.getAttribute("aria-disabled")]; });
      const before = JSON.stringify(await anno());
      // aria-disabled: Playwright would wait for it to be enabled; the click
      // is a person's, and must change nothing.
      await page.locator("#ov-tr-add-menu [data-first]").click({ force: true });
      await wait(300);
      m.off = { same: JSON.stringify(await anno()) === before, open: await page.evaluate(() => !!document.getElementById("ov-tr-add-menu")) };
      await page.keyboard.press("Escape");
    } catch (e) { err = errText(e); }
    const ok = !err &&
      JSON.stringify(m.look.labels) === JSON.stringify(["Add step here|Adds a step that starts where this is said.",
        "Copy to...|Copies this sentence into the description of a step or a field of the document."]) &&
      m.look.idle === "0" && m.look.current === "1" && m.look.display !== "none" && m.look.focused.opacity === "1" && m.look.focused.h === m.look.h &&
      m.added.at === 19 && m.added.shot && m.added.tab === "steps" && m.added.inPane &&
      m.menu.head === "Copy this sentence to" && m.menu.items[0] === 'The description of "Step 1"' && m.menu.focus === 'The description of "Step 1"' &&
      m.menu.items.includes("Exceptions") && m.desc && m.doc &&
      JSON.stringify(m.offItem) === '["The description of a step (select a step first)","true"]' && m.off.same && m.off.open;
    record("(m) lane E, E3: each sentence carries Add step here and Copy to... (transparent on a row neither under the pointer, nor focused, nor the playhead's, shown there, the row's height unchanged); Add step here, by the keyboard, adds a step at its moment with the video's frame, and (lane PANE) the step opens in place in the pane's Steps tab; back on the Transcript tab, Copy to... opens one menu, \"Copy this sentence to\", the selected step's description first (focused), then the document's fields (Exceptions); with no step selected the description item says to select one and changes nothing",
      ok, JSON.stringify({ err, m }));
    if (!ok) await shot(page, "fail-transcript-lanee-acts.png");
  }

  // (n) a stretch put aside, and read only.
  {
    let n = {}, err = null;
    try {
      await page.evaluate(async (t0) => {
        const S = require("./session.js");
        const a = require("./state.js").getSession().annotations;
        a.excluded_ranges = [{ start: new Date(t0 + 8000).toISOString(), end: new Date(t0 + 16000).toISOString(), reason: "manual" }];
        // The tab follows every change of the stretches (the "timeline" topic).
        await S.persistAnnotations(a, "Not part of the process", ["timeline"]);
      }, LANE_E_T0);
      await page.waitForSelector(".trt-gap", { timeout: T });
      n.aside = await page.evaluate(() => ({ gap: document.querySelector(".trt-gap .trt-gap-text").textContent,
        include: !!document.querySelector(".trt-gap .trt-include"), rows: document.querySelectorAll(".trt-row").length,
        texts: [...document.querySelectorAll(".trt-row .tr-text")].map((x) => x.textContent) }));
      await page.click(".trt-gap .trt-include");
      await page.waitForFunction(() => (require("./state.js").getSession().annotations.excluded_ranges || []).length === 0, null, { timeout: T });
      await wait(300);
      n.back = await page.evaluate(() => ({ rows: document.querySelectorAll(".trt-row").length, gaps: document.querySelectorAll(".trt-gap").length }));
      n.ro = await page.evaluate(() => {
        const s = require("./state.js").getSession();
        s.readOnly = true;
        const T = require("./views/flow-view-transcript.js");
        T.renderTab(true);
        const out = { more: document.querySelectorAll(".trt-acts").length, rows: document.querySelectorAll(".trt-row").length,
          search: !!document.querySelector(".trt-search") };
        delete s.readOnly;
        T.renderTab(true);
        return out;
      });
    } catch (e) { err = errText(e); }
    const ok = !err && n.aside.gap === "Not part of the process: 0:08 to 0:16" && n.aside.include && n.aside.rows === 11 &&
      !n.aside.texts.some((t) => /game|extra time|Lunch|missed/.test(t)) && n.back.rows === 15 && n.back.gaps === 0 &&
      n.ro.more === 0 && n.ro.rows === 15 && n.ro.search;
    record("(n) lane E, E3 and E4: a stretch put aside is one row, \"Not part of the process: 0:08 to 0:16\", in place of its sentences, with Include again, which brings them back; read only, the list and its search stay and no act is offered",
      ok, JSON.stringify({ err, n }));
    if (!ok) await shot(page, "fail-transcript-lanee-aside.png");
  }

  // (o) Lane W2: the speed, the caption under the video, I and O.
  {
    const o = {};
    let err = null;
    const box = (id) => page.evaluate((i) => { const b = document.getElementById(i).getBoundingClientRect();
      return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }; }, id);
    try {
      await page.mouse.move(5, 5);
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      // The speed: 2x, the clock twice as fast over a second of real time.
      o.speedShown = await page.evaluate(() => { const s = document.getElementById("tl-speed"); return !s.hidden && s.getClientRects().length > 0; });
      await page.selectOption("#tl-speed", "2");
      await page.evaluate((t) => require("./views/flow-view-video.js").seekClock(t, false), LANE_E_T0 + 500);
      await wait(400);
      // The caption, sampled every frame while the video plays across the
      // first sentences (1 s to 2.6 s, 3 s to 4.6 s).
      await page.evaluate(() => {
        window.__w2caps = [];
        const say = document.getElementById("video-caption-say");
        const band = document.getElementById("video-caption");
        const tick = () => {
          window.__w2caps.push({ text: say.hidden ? "" : say.textContent, h: Math.round(band.getBoundingClientRect().height) });
          if (window.__w2capOn) requestAnimationFrame(tick);
        };
        window.__w2capOn = true;
        requestAnimationFrame(tick);
      });
      await page.evaluate(() => document.getElementById("video").play());
      await page.waitForFunction(() => require("./views/flow-view-video.js").playheadMs() > Date.parse("2026-11-10T09:00:01.200Z"), null, { timeout: T, polling: 20 });
      const r1 = await page.evaluate(() => ({ at: require("./views/flow-view-video.js").playheadMs(), now: performance.now() }));
      await wait(1000);
      const r2 = await page.evaluate(() => ({ at: require("./views/flow-view-video.js").playheadMs(), now: performance.now() }));
      o.ratio = Math.round(((r2.at - r1.at) / (r2.now - r1.now)) * 100) / 100;
      await page.waitForFunction(() => require("./views/flow-view-video.js").playheadMs() > Date.parse("2026-11-10T09:00:05.300Z"), null, { timeout: T, polling: 20 });
      await page.evaluate(() => { document.getElementById("video").pause(); window.__w2capOn = false; });
      const caps = await page.evaluate(() => window.__w2caps);
      o.caps = caps.map((c) => c.text).filter((c, i, a) => i === 0 || c !== a[i - 1]);
      o.heights = [...new Set(caps.map((c) => c.h))];
      await page.selectOption("#tl-speed", "1");
      // The caption's look, and what it does: the Transcript tab at its sentence.
      await page.evaluate((t) => require("./views/flow-view-video.js").seekClock(t, false), LANE_E_T0 + 1500);
      await wait(400);
      o.look = await page.evaluate(() => { const s = document.getElementById("video-caption-say");
        return { size: getComputedStyle(s.querySelector(".cap-lines")).fontSize, bold: Number(getComputedStyle(s.querySelector(".cap-speaker")).fontWeight),
          title: s.title, clamp: getComputedStyle(s.querySelector(".cap-lines")).webkitLineClamp }; });
      o.geo = { video: await box("video"), caption: await box("video-caption"), row: await box("tl-row") };
      await page.locator("#tp-tab-steps").click({ timeout: T });
      await page.locator("#video-caption-say").click({ timeout: T });
      await wait(300);
      o.clicked = await page.evaluate(() => ({ tab: document.querySelector("#tp-tabs .anno-tab.active").dataset.anno,
        current: (document.querySelector(".trt-row.current .tr-text") || {}).textContent }));
      // I and O while the video plays: I at 0:05, O at 0:12.
      await page.evaluate((t) => require("./views/flow-view-video.js").seekClock(t, false), LANE_E_T0 + 4500);
      await page.mouse.move(5, 5);
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); document.getElementById("video").play(); });
      await page.waitForFunction(() => require("./views/flow-view-video.js").playheadMs() >= Date.parse("2026-11-10T09:00:05.050Z"), null, { timeout: T, polling: 10 });
      await page.keyboard.press("i");
      await wait(120);
      o.afterI = await page.evaluate(() => ({ message: ((document.querySelector("#toast .toast-text") || document.getElementById("toast") || {}).textContent || "").trim(),
        mark: ((document.getElementById("tl-stretch-mark") || {}).textContent || ""), playing: !document.getElementById("video").paused,
        focus: document.activeElement === document.body, asked: [...document.querySelectorAll(".modal-backdrop")].some((m) => getComputedStyle(m).display !== "none") }));
      await page.waitForFunction(() => require("./views/flow-view-video.js").playheadMs() >= Date.parse("2026-11-10T09:00:12.050Z"), null, { timeout: T, polling: 10 });
      await page.keyboard.press("o");
      await wait(150);
      o.afterO = await page.evaluate(() => ({ times: document.getElementById("tl-selection-times").textContent,
        acts: [...document.querySelectorAll("#tl-selection button")].filter((b) => !b.hidden).map((b) => b.textContent.trim()),
        playing: !document.getElementById("video").paused, mark: !!document.getElementById("tl-stretch-mark"),
        focus: document.activeElement === document.body }));
      await page.evaluate(() => document.getElementById("video").pause());
      await shot(page, "w2-transcript-io.png");
      // I and O at one moment: no stretch, and why; Escape clears the start.
      await page.click("#tl-selection-clear");
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
      await page.keyboard.press("i");
      await page.keyboard.press("o");
      await wait(120);
      o.same = await page.evaluate(() => ({ message: ((document.querySelector("#toast .toast-text") || document.getElementById("toast") || {}).textContent || "").trim(),
        selected: !!require("./state.js").getSelectionRange(), mark: !!document.getElementById("tl-stretch-mark") }));
      await page.keyboard.press("Escape");
      o.escaped = await page.evaluate(() => !document.getElementById("tl-stretch-mark"));
    } catch (e) { err = errText(e); }
    const g = o.geo || {};
    const ok = !err && o.speedShown && o.ratio >= 1.7 && o.ratio <= 2.3 &&
      JSON.stringify(o.caps).includes(JSON.stringify(["Maria Keller So this is how an order comes in.", "", "Maria Keller I open the shared mailbox first."]).slice(1, -1)) &&
      o.heights.length === 1 && o.heights[0] > 0 &&
      o.look.size === "14px" && o.look.bold >= 600 && o.look.clamp === "2" &&
      o.look.title === "Maria Keller: So this is how an order comes in.\nClick: show it in the Transcript tab." &&
      g.video.b <= g.caption.t && g.caption.b <= g.row.t && g.caption.h > 0 &&
      o.clicked.tab === "transcript" && o.clicked.current === "So this is how an order comes in." &&
      o.afterI.message === "Stretch starts at 0:05." && o.afterI.mark === "Start of a stretch" && o.afterI.playing && o.afterI.focus && !o.afterI.asked &&
      o.afterO.times === "0:05 to 0:12 · 7s" &&
      JSON.stringify(o.afterO.acts) === JSON.stringify(["Not part of the process", "Make it a transaction", "Clear selection"]) &&
      o.afterO.playing && !o.afterO.mark && o.afterO.focus &&
      o.same.message === "A stretch needs a start and an end at two moments." && !o.same.selected && o.same.mark && o.escaped;
    record("(o) lane W2: the speed at 2x runs the clock about twice as fast; the caption under the video shows each sentence in turn, the speaker in bold, 14 px, on two lines at most, and is empty between them, its height kept; video, caption and row do not overlap; a click on it opens the Transcript tab at its sentence; I at 0:05 and O at 0:12, playing, select \"0:05 to 0:12 · 7s\" with its acts, the video playing on, nothing asked and no focus taken; I and O at one moment say why, and Escape clears the start",
      ok, JSON.stringify({ err, o }));
    if (!ok) await shot(page, "fail-transcript-w2.png");
  }

  record("lane E: zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
}

(async () => {
  const pre = readJson(ANNO);
  const stats = readJson(path.join(SESSION, "stats.json"));
  const run1 = (stats.case_stats || []).filter((c) => !c.parent_case_id)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts))[0] || {};
  const stepNamed = (name) => (pre.steps || []).find((s) => s.case_id === run1.case_id && s.name === name) || {};
  const SAVE = stepNamed("Salesforce - Order: Save order");
  const EXCEL = stepNamed("Excel - Order Tracking.xlsx: Save workbook");

  const preOk = !!(SAVE.step_id && EXCEL.step_id && !fs.existsSync(TRANSCRIPT) &&
    SAVE.time_range.start === "2026-05-14T09:00:29Z" && SAVE.time_range.end === "2026-05-14T09:00:37Z");
  record("precondition: the demo analyzes to run 1 with its Save order step at 09:00:29 to 09:00:37, and no transcript",
    preOk, JSON.stringify({ save: SAVE.time_range, excel: EXCEL.time_range }));
  if (!preOk) process.exit(1);

  let viewer;
  try {
    viewer = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + SESSION], cwd: VIEWER });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const { app } = viewer;
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });

  /* ---- helpers ------------------------------------------------------------ */
  const level = async (name) => {
    await page.locator('.view-mode-btn[data-level="' + name + '"]').click({ timeout: T });
    await page.waitForFunction((l) => {
      const el = document.getElementById("session-layout-" + l);
      return !!el && getComputedStyle(el).display !== "none";
    }, name, { timeout: T });
  };
  const stubOpen = (file) => app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, file);
  // Attach (Replace) and Remove live on the Overview's recording line.
  const menuItem = async (id) => {
    await level("overview");
    await page.locator("#ov-summary #" + id).click({ timeout: T });
  };
  const waitToast = (re) => page.waitForFunction((src) => {
    const el = document.getElementById("toast");
    return !!(el && el.classList.contains("show") && new RegExp(src).test(el.textContent || ""));
  }, re.source, { timeout: 60000 });
  const toastNow = () => page.$eval("#toast", (el) => ({ text: el.textContent || "", error: el.className.includes("error") }));
  // Every transcript surface's state, read from the DOM (the lane is drawn
  // whatever level shows; the step editor and the Overview as last rendered).
  const surfaces = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const label = q("#timeline .tl-tr-label");
    const said = q("#step-said");
    const ov = q("#ov-tr");
    return {
      attach: (q("#btn-attach-transcript") || {}).textContent || null,
      lineState: ((q('#ov-summary [data-summary="transcript"]') || {}).textContent || "").trim(),
      removeHidden: !q("#btn-remove-transcript"),
      laneActs: label ? [...label.querySelectorAll("button")].map((b) => (b.textContent || "").trim()) : [],
      laneRowHidden: !!(q("#lane-transcript-row") || {}).hidden,
      label: label ? label.textContent.trim() : null,
      // The lane's name, at the left of the timeline with the other lanes'.
      laneName: ((q('#tl-lane-names .tl-lane-name[data-lane="transcript"]') || {}).textContent || null),
      syncAction: !!(label && label.querySelector(".tl-tr-sync")),
      blocks: [...document.querySelectorAll("#timeline .tl-tr-block")].map((b) => b.dataset.seg),
      said: said ? {
        note: ((said.querySelector(".tr-note") || {}).textContent || "").trim(),
        rows: [...said.querySelectorAll(".tr-row .tr-text")].map((e) => e.textContent),
        buttons: [...said.querySelectorAll(".tr-add")].map((b) => ({ seg: b.dataset.seg, text: b.textContent, disabled: b.disabled })),
      } : null,
      overview: ov ? {
        count: ((q("#ov-tr-count") || {}).textContent || "").trim(),
        what: ((q("#ov-tr-what") || {}).textContent || "").trim(),
        note: ((ov.querySelector(".tr-note") || {}).textContent || "").trim(),
        during: !!ov.querySelector(".ov-tr-during-cb"),
        duringLabel: ((ov.querySelector(".ov-tr-during") || {}).textContent || "").trim(),
        rows: [...ov.querySelectorAll(".tr-row .tr-text")].map((e) => e.textContent),
        times: [...ov.querySelectorAll(".tr-row .tr-time")].map((e) => ({ text: e.textContent, title: e.title || "" })),
        // P1.10: the disclosure sits in the document sections, which sit
        // directly under the summary line.
        inDocUnderSummary: !!(ov.closest("#ov-doc") && q("#ov-summary") &&
          q("#ov-summary").nextElementSibling === q("#ov-doc")),
      } : null,
    };
  });
  // P1.7: the Description (with "Said during this step" under it) is resident
  // in the step detail, not behind its More disclosure.
  const openStep = async (stepId) => {
    await level("steps");
    await page.locator('#step-list .step-row[data-step-id="' + stepId + '"]').click({ timeout: T });
    await page.waitForSelector("#step-detail #step-desc", { state: "visible", timeout: T });
  };
  const openOverviewTranscript = async () => {
    await level("overview");
    await page.evaluate(() => {
      const doc = document.getElementById("ov-doc");
      if (doc && !doc.open) doc.querySelector("summary").click();
      const tr = document.getElementById("ov-tr");
      if (tr && !tr.open) tr.querySelector("summary").click();
    });
  };

  // ---- (a) before an import: only the menu item --------------------------
  {
    let err = null, st = null;
    try {
      await openStep(SAVE.step_id);
      await openOverviewTranscript();
      await level("flow");
      st = await surfaces();
    } catch (e) { err = errText(e); }
    const ok = !err && st.attach === "Attach a transcript..." && st.lineState === "No transcript" && st.removeHidden && st.laneRowHidden &&
      st.label === null && st.laneName === null && st.blocks.length === 0 && st.said === null && st.overview === null &&
      !(await page.$("#btn-session-more-menu, #session-more-popup"));
    record("(a) before an import the only transcript UI is Attach a transcript... in the Overview's transcript row (No transcript, plan D5)", ok, JSON.stringify({ err, st }));
    if (!ok) await shot(page, "fail-transcript-before.png");
  }

  // ---- (b) Attach transcript --------------------------------------------
  {
    let err = null, toast = null, st = null;
    try {
      await stubOpen(FIXTURE);
      await menuItem("btn-attach-transcript");
      await waitToast(/Transcript attached/);
      toast = await toastNow();
      st = await surfaces();
    } catch (e) { err = errText(e); }
    const doc = fs.existsSync(TRANSCRIPT) ? readJson(TRANSCRIPT) : null;
    const copied = fs.existsSync(COPY) && fs.readFileSync(COPY).equals(fs.readFileSync(FIXTURE));
    const ok = !err && doc && doc.version === 1 && doc.offset_ms === null && doc.source_file === "transcript/meeting-transcript.vtt" &&
      (doc.segments || []).length === 10 && doc.segments.every((s) => S[s.id] === s.text) && copied &&
      toast.text === "Transcript attached: 10 sentences, 2 speakers. Sync it on the Timeline to place it." &&
      st.attach === "Replace the transcript..." && st.lineState === "meeting-transcript.vtt" && !st.removeHidden && !st.laneRowHidden;
    record("(b) Attach transcript writes transcript.json (10 sentences, not synced) and the copied original; the transcript row (plan D5) names its file and offers Replace the transcript... and Remove the transcript",
      ok, JSON.stringify({ err, toast, copied, segments: doc && doc.segments.length, offset: doc && doc.offset_ms, menu: st && [st.attach, st.removeHidden] }));
    if (!ok) await shot(page, "fail-transcript-import.png");
  }

  // ---- (c) not synced, on all three surfaces -----------------------------
  {
    let err = null, flow = null, step = null, ov = null;
    try {
      await level("flow");
      flow = await surfaces();
      await openStep(SAVE.step_id);
      step = (await surfaces()).said;
      await openOverviewTranscript();
      ov = (await surfaces()).overview;
    } catch (e) { err = errText(e); }
    const ok = !err && flow.laneName === "Transcript" && /Not synced/.test(flow.label) && flow.syncAction &&
      JSON.stringify(flow.laneActs) === JSON.stringify(["Sync the transcript...", "Replace the transcript...", "Remove the transcript"]) &&
      flow.blocks.length === 0 && step && step.note === NOT_SYNCED && step.rows.length === 0 && step.buttons.length === 0 &&
      ov && ov.count === "(10)" && ov.rows.length === 10 && ov.note === NOT_SYNCED && !ov.during && ov.inDocUnderSummary &&
      ov.what === "Everything that was said";
    record("(c) not synced: the lane, named Transcript at the left, says Not synced with Sync the transcript..., Replace the transcript... and Remove the transcript (lane A-2: each names its object), the step editor shows one line, the Overview lists all 10 (\"Everything that was said\") with the line and no transactions filter, in the document under the project line",
      ok, JSON.stringify({ err, label: flow && flow.label, laneName: flow && flow.laneName, blocks: flow && flow.blocks.length, step, ov: ov && { count: ov.count, what: ov.what, rows: ov.rows.length, note: ov.note, during: ov.during, inDocUnderSummary: ov.inDocUnderSummary } }));
    if (!ok) await shot(page, "fail-transcript-not-synced.png");
  }

  // ---- (d) Sync -----------------------------------------------------------
  {
    let err = null, picks = null, step2 = null, disk = null, st = null;
    try {
      await level("flow");
      await page.locator("#timeline .tl-tr-sync").click({ timeout: T });
      await page.waitForSelector("#transcript-sync-card .tr-sync-search", { timeout: T });
      await page.locator("#transcript-sync-card .tr-sync-search").fill("search for the customer", { timeout: T });
      picks = await page.$$eval("#transcript-sync-card .tr-sync-pick", (bs) => bs.map((b) => b.dataset.seg));
      await page.locator('#transcript-sync-card .tr-sync-pick[data-seg="t0004"]').click({ timeout: T });
      step2 = await page.$eval("#transcript-sync-card .vs-text", (el) => el.textContent);
      const pt = await page.evaluate((iso) => {
        const tl = document.getElementById("timeline");
        const evs = require("./state.js").getSession().events;
        const first = Date.parse(evs[0].timestamp), last = Date.parse(evs[evs.length - 1].timestamp);
        const r = tl.getBoundingClientRect();
        const band = tl.querySelector(".tl-activity").getBoundingClientRect();
        return { x: r.left + ((Date.parse(iso) - first) / (last - first)) * r.width, y: band.top + band.height / 2 };
      }, SYNC_AT);
      await page.mouse.click(pt.x, pt.y);
      disk = await waitDisk(TRANSCRIPT, (d) => typeof d.offset_ms === "number");
      await page.waitForFunction(() => document.querySelectorAll("#timeline .tl-tr-block").length > 0, null, { timeout: T });
      st = await surfaces();
    } catch (e) { err = errText(e); }
    const offset = disk && disk.offset_ms;
    const ok = !err && JSON.stringify(picks) === '["t0004"]' && /Step 2 of 2/.test(step2) &&
      typeof offset === "number" && Math.abs(offset - WANT_OFFSET) <= 1000 &&
      JSON.stringify(st.blocks) === JSON.stringify(["t0003", "t0004", "t0005", "t0006", "t0007", "t0008", "t0009"]) &&
      !/Not synced/.test(st.label) && st.syncAction && !(await page.$("#transcript-sync-card"));
    record("(d) Sync: pick a sentence, click its moment on the timeline; offset_ms is saved and the lane draws the 7 sentences said while recording",
      ok, JSON.stringify({ err, picks, step2, offset, blocks: st && st.blocks, label: st && st.label }));
    if (!ok) await shot(page, "fail-transcript-sync.png");
  }

  // ---- (e) the step editor ------------------------------------------------
  {
    let err = null, listed = null, desc = null, after = null, empty = null, hint = null, panelSaid = null, before = null;
    try {
      // 2.0.1: a sentence shows under one step only: every step of run 1
      // with the sentences said during it, as the step pane lists them.
      before = await page.evaluate((caseId) => {
        const s = require("./state.js").getSession();
        const TM = require("./transcript-model.js");
        const run = require("./runs-model.js").buildRuns(s.stats, (s.annotations || {}).steps || []).runs.find((r) => r.caseId === caseId);
        const placed = TM.forSession(s);
        return run.visible.map((st) => ({ id: st.step_id, said: TM.sentencesForStep(placed.sentences, st, run.visible).map((x) => x.id) }));
      }, run1.case_id);
      await openStep(SAVE.step_id);
      listed = (await surfaces()).said;
      // Plan D2: on Steps the step panel's row shows no sentence (the editor
      // beside it lists them); on the Map (below) its row shows them under a
      // Said: lead (the owner's review).
      const panelRow = () => page.evaluate((id) => {
        const r = document.querySelector('#step-panel:not([hidden]) #sp-body .sp-occ[data-step-id="' + id + '"]');
        return r ? { leads: [...r.querySelectorAll(".sp-lead")].map((l) => (l.textContent || "").trim()),
          lines: [...r.querySelectorAll(".sp-said .tr-text")].map((e) => e.textContent) } : null;
      }, SAVE.step_id);
      panelSaid = { steps: await panelRow() };
      // Item 1: the drafting's narration is not the description's text (2.0.1:
      // nor its hint; the actions are under Recorded).
      hint = await page.$eval("#step-desc", (el) => ({ value: el.value, placeholder: el.placeholder }));
      // Add saves the description at once (no Save button).
      await page.locator('#step-said .tr-add[data-seg="t0005"]').click({ timeout: T });
      desc = await page.$eval("#step-desc", (el) => el.value);
      await waitDisk(ANNO, (a) => ((a.steps || []).find((s) => s.step_id === SAVE.step_id) || {}).description === desc.trim());
      await page.waitForFunction(() => {
        const b = document.querySelector('#step-said .tr-add[data-seg="t0005"]');
        return !!(b && b.disabled && b.textContent === "Added");
      }, null, { timeout: T });
      after = (await surfaces()).said;
      await openStep(EXCEL.step_id);
      empty = (await surfaces()).said;
      // The Map: a box opens the panel, its row with what was said.
      await level("map");
      await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
      const runsLink = page.locator("#btn-map-show-runs");
      if (await runsLink.isVisible()) await runsLink.click({ timeout: T });
      await page.waitForFunction(() => { const h = document.getElementById("session-map-dfg-host"); return !!(h && h.__cy && h.getClientRects().length); }, null, { timeout: T });
      await page.evaluate((n) => { document.getElementById("session-map-dfg-host").__cy.getElementById(n).emit("tap"); }, SAVE.name);
      await page.waitForFunction((id) => !!document.querySelector('#step-panel:not([hidden]) #sp-body .sp-occ[data-step-id="' + id + '"]'), SAVE.step_id, { timeout: T });
      panelSaid.map = await panelRow();
    } catch (e) { err = errText(e); }
    const saved = ((readJson(ANNO).steps || []).find((s) => s.step_id === SAVE.step_id) || {});
    // The draft's narration is not the description, so it holds the sentence alone.
    const appended = typeof desc === "string" && desc === S.t0005;
    const hintOk = !!hint && hint.value === "" && hint.placeholder === "What the person does in this step";
    const button = (list, seg) => ((list && list.buttons) || []).find((b) => b.seg === seg) || {};
    const resident = await page.evaluate(() => {
      const more = document.querySelector("#step-detail .step-detail-more");
      const said = document.getElementById("step-said");
      return { moreClosed: !more, saidOutsideMore: !!(said && !(more && more.contains(said))),
        descOutsideMore: !!(document.getElementById("step-desc") && !(more && more.contains(document.getElementById("step-desc")))) };
    }).catch((e) => ({ err: e.message }));
    const ok = !err && resident.moreClosed && resident.saidOutsideMore && resident.descOutsideMore &&
      !!before && before.every((b) => b.said.every((id) => before.filter((c) => c.said.includes(id)).length === 1)) &&
      before.filter((b) => b.said.includes("t0004")).length === 1 &&
      !before.find((b) => b.id === SAVE.step_id).said.includes("t0004") &&
      !!listed && JSON.stringify(listed.rows) === JSON.stringify([S.t0005]) &&
      listed.buttons.every((b) => b.text === "Add" && !b.disabled) && appended && hintOk &&
      typeof saved.description === "string" && saved.description === S.t0005 && saved.state === "edited" &&
      button(after, "t0005").text === "Added" &&
      !!empty && empty.note === "Nothing was said during this step." && empty.rows.length === 0 &&
      !!panelSaid && (panelSaid.steps === null || (panelSaid.steps.leads.length === 0 && panelSaid.steps.lines.length === 0)) &&
      !!panelSaid.map && JSON.stringify(panelSaid.map.leads) === '["Said:"]' && JSON.stringify(panelSaid.map.lines) === JSON.stringify([S.t0005]);
    record("(e) the step editor lists the sentences that start in the step's window (10 s lead, not past the step before) under the resident Description (the draft's narration is not its text), Add fills it and saves it (no Save button), the button reads Added; a quiet step says so; the step panel's row on the Map shows them under a Said: lead (plan D2: on Steps its row shows none, the editor has them); each sentence of run 1 shows under one step only, t0004 not under Save order",
      ok, JSON.stringify({ err, resident, before, listed, panelSaid, hint, desc: desc && desc.slice(-80), saved: saved.description && saved.description.slice(-80), after: after && after.buttons, empty }));
    if (!ok) await shot(page, "fail-transcript-step.png");
  }

  // ---- (f) the Overview ---------------------------------------------------
  {
    let err = null, def = null, analyst = null, search = null, during = null, field = null, menu = null, disk = null;
    const rows = async () => (await surfaces()).overview;
    try {
      await openOverviewTranscript();
      def = await rows();
      await page.selectOption("#ov-tr .ov-tr-speaker", "Analyst");
      analyst = await rows();
      await page.selectOption("#ov-tr .ov-tr-speaker", "");
      await page.locator("#ov-tr .ov-tr-search").fill("manager", { timeout: T });
      search = await rows();
      await page.locator("#ov-tr .ov-tr-search").fill("", { timeout: T });
      await page.locator("#ov-tr .ov-tr-during-cb").check({ timeout: T });
      during = await rows();
      await page.locator("#ov-tr .ov-tr-during-cb").uncheck({ timeout: T });
      await page.locator('#ov-tr .tr-add-to[data-seg="t0007"]').click({ timeout: T });
      await page.locator('#ov-tr-add-menu [data-doc-target="business_rules"]').click({ timeout: T });
      field = await page.$eval('#ov-doc [data-doc="business_rules"]', (el) => el.value);
      disk = await waitDisk(ANNO, (a) => ((a.document || {}).business_rules || "").includes(S.t0007));
      await page.locator('#ov-tr .tr-add-to[data-seg="t0007"]').click({ timeout: T });
      menu = await page.$$eval("#ov-tr-add-menu [data-doc-target]", (bs) => bs.map((b) => ({ key: b.dataset.docTarget, text: b.textContent, disabled: b.disabled })));
      await page.keyboard.press("Escape");
    } catch (e) { err = errText(e); }
    const outside = [S.t0001, S.t0002, S.t0003, S.t0006, S.t0007, S.t0009, S.t0010];
    const br = menu && menu.find((m) => m.key === "business_rules");
    // AD-29: the title line says what the list holds; the two sentences said
    // before the recording read "m:ss before", and no time is negative.
    const before = def ? def.times.filter((x) => / before$/.test(x.text)) : [];
    const noMinus = [def, during].every((v) => v && v.times.every((x) => !/^-/.test(x.text)));
    const okWords = !err && def && def.what === "What was said outside the transactions" &&
      during && during.what === "What was said, during the transactions too" &&
      def.duringLabel === "Include talk during the transactions" &&
      before.length === 2 && before.every((x) => /^\d+:\d{2} before$/.test(x.text) &&
        x.title === "Said " + x.text.replace(/ before$/, "") + " before the recording started") &&
      JSON.stringify(def.rows.slice(0, 2)) === JSON.stringify([S.t0001, S.t0002]) &&
      def.times.slice(0, 2).every((x) => / before$/.test(x.text)) && noMinus;
    record("(f) AD-29: the Overview's list says what it holds (outside the transactions, or during them too), its checkbox reads Include talk during the transactions, and the sentences said before the recording read m:ss before (never a negative time)",
      okWords, JSON.stringify({ err, what: def && def.what, duringWhat: during && during.what, duringLabel: def && def.duringLabel,
        times: def && def.times.slice(0, 3), noMinus }));
    const ok = !err && def && def.count === "(7)" && JSON.stringify(def.rows) === JSON.stringify(outside) && def.note === "" && def.during &&
      JSON.stringify(analyst.rows) === JSON.stringify([S.t0001, S.t0006, S.t0009]) &&
      JSON.stringify(search.rows) === JSON.stringify([S.t0007]) && search.count === "(1)" &&
      during.rows.length === 10 && during.count === "(10)" &&
      field === S.t0007 && disk && disk.document.business_rules === S.t0007 &&
      JSON.stringify(menu.map((m) => m.key)) === JSON.stringify(["purpose", "scope", "trigger", "result", "business_rules", "exceptions", "effort", "improvement", "notes"]) &&
      br && br.disabled && br.text === "Business rules (added)" && menu.filter((m) => m.disabled).length === 1;
    record("(f) the Overview lists the talk outside the transactions (7); the speaker filter, the search and the transactions checkbox narrow and widen it; Add to offers every field but the title and contacts (trigger, result, volume and effort, and improvement included) and Business rules saves document.business_rules",
      ok, JSON.stringify({ err, def: def && { count: def.count, n: def.rows.length }, analyst: analyst && analyst.rows.length, search: search && search.rows, during: during && during.rows.length, field, menu }));
    if (!ok) await shot(page, "fail-transcript-overview.png");
  }

  // ---- (g) an unsupported file -------------------------------------------
  {
    let err = null, toast = null, st = null;
    const before = fs.readFileSync(TRANSCRIPT);
    try {
      await stubOpen(BAD);
      await menuItem("btn-attach-transcript");
      await waitToast(/not attached/);
      toast = await toastNow();
      st = await surfaces();
    } catch (e) { err = errText(e); }
    const kept = fs.readFileSync(TRANSCRIPT).equals(before);
    const ok = !err && toast.error && toast.text.includes("call-notes.vtt") && toast.text.includes("Nothing was written") &&
      !toast.text.includes("[transcript]") && kept && st.blocks.length === 7 && !fs.existsSync(path.join(SESSION, "transcript", "call-notes.vtt"));
    record("(g) an unsupported file fails with the import's own message, and the previous transcript stays as it was",
      ok, JSON.stringify({ err, toast, kept, blocks: st && st.blocks.length }));
    if (!ok) await shot(page, "fail-transcript-bad-file.png");
  }

  // ---- (i) the pulled sentences reach the PDD ------------------------------
  {
    let err = null, xml = null;
    const out = path.join(FILES, "transcript-e2e.docx");
    try {
      await app.evaluate(({ dialog, shell }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
        shell.showItemInFolder = () => {};
      }, out);
      await page.locator("#btn-session-export-menu").click({ timeout: T });
      await page.locator("#btn-session-pdd").click({ timeout: T });
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && !xml) {
        if (fs.existsSync(out)) {
          const buf = fs.readFileSync(out);
          if (buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b) {
            try { xml = readZipEntry(buf, "word/document.xml"); } catch (_) { /* still being written */ }
          }
        }
        if (!xml) await wait(500);
      }
    } catch (e) { err = errText(e); }
    const ok = !err && !!xml && xml.includes(S.t0005) && xml.includes(S.t0007);
    record("(i) the exported PDD carries the sentence pulled into the step's description and the one added to Business rules",
      ok, JSON.stringify({ err, docx: !!xml, step: !!(xml && xml.includes(S.t0005)), rule: !!(xml && xml.includes(S.t0007)) }));
    if (!ok) await shot(page, "fail-transcript-pdd.png");
  }

  // ---- (h) Remove transcript ---------------------------------------------
  {
    let err = null, st = null, stepSaid = null, ov = null;
    try {
      await level("flow");
      await menuItem("btn-remove-transcript");
      await waitToast(/Transcript removed/);
      st = await surfaces();
      await openStep(SAVE.step_id);
      stepSaid = (await surfaces()).said;
      await openOverviewTranscript();
      ov = (await surfaces()).overview;
    } catch (e) { err = errText(e); }
    const gone = { json: fs.existsSync(TRANSCRIPT), copy: fs.existsSync(COPY) };
    const ok = !err && !gone.json && !gone.copy &&
      st.attach === "Attach a transcript..." && st.lineState === "No transcript" && st.removeHidden && st.laneRowHidden && st.label === null && st.laneName === null &&
      st.blocks.length === 0 && stepSaid === null && ov === null && !(await page.$("#transcript-sync-card"));
    record("(h) lane CC: Remove transcript takes out transcript.json and its original transcript/meeting-transcript.vtt, and every transcript surface is gone",
      ok, JSON.stringify({ err, gone, st, stepSaid, ov }));
    if (!ok) await shot(page, "fail-transcript-remove.png");
    // Ctrl+Z puts both files back and the transcript shows again; Ctrl+Y
    // takes them out again.
    let undo = null, redo = null, uerr = null;
    try {
      await page.evaluate(async () => { await require("./session.js").performUndo(); });
      await page.waitForFunction(() => !!(require("./state.js").getSession() || {}).transcript, null, { timeout: 20000 });
      undo = Object.assign({ json: fs.existsSync(TRANSCRIPT), copy: fs.existsSync(COPY) }, await surfaces());
      await page.evaluate(async () => { await require("./session.js").performRedo(); });
      await page.waitForFunction(() => !(require("./state.js").getSession() || {}).transcript, null, { timeout: 20000 });
      redo = Object.assign({ json: fs.existsSync(TRANSCRIPT), copy: fs.existsSync(COPY) }, await surfaces());
    } catch (e) { uerr = errText(e); }
    const uok = !uerr && undo && undo.json && undo.copy && undo.attach === "Replace the transcript..." && undo.lineState === "meeting-transcript.vtt" && !undo.removeHidden &&
      redo && !redo.json && !redo.copy && redo.attach === "Attach a transcript..." && redo.lineState === "No transcript";
    record("(h) lane CC: Ctrl+Z brings the transcript and its original file back (the transcript row names its file again, plan D5), Ctrl+Y takes them out again",
      uok, JSON.stringify({ uerr, undo: undo && [undo.json, undo.copy, undo.attach, undo.lineState], redo: redo && [redo.json, redo.copy, redo.attach, redo.lineState] }));
    if (!uok) await shot(page, "fail-transcript-remove-undo.png");
  }

  // ---- (j) a transcript.json that cannot be read --------------------------
  {
    let err = null, toast = null, st = null, after = null, again = null;
    const reload = () => page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), SESSION);
    try {
      fs.writeFileSync(TRANSCRIPT, "{ this is not a transcript");
      await reload();
      await waitToast(/could not be read/);
      toast = await toastNow();
      st = await surfaces();
      // Said once: a reload of the same state (an Analyze does one) stays quiet.
      await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
      await reload();
      await wait(800);
      again = await page.$eval("#toast", (el) => el.classList.contains("show") && /could not be read/.test(el.textContent));
      await menuItem("btn-remove-transcript");
      await waitToast(/Transcript removed/);
      after = await surfaces();
    } catch (e) { err = errText(e); }
    const ok = !err && toast.error && /^The transcript could not be read: it is not valid JSON \(.+\)\. Replace it on the Overview, in the Transcript row\.$/.test(toast.text) &&
      st.attach === "Replace the transcript..." && st.lineState === "The transcript cannot be read" && !st.removeHidden && st.laneRowHidden && st.label === null &&
      st.laneName === null && st.said === null && st.overview === null && again === false &&
      !fs.existsSync(TRANSCRIPT) && after.attach === "Attach a transcript..." && after.removeHidden;
    record("(j) a transcript.json that cannot be read is said once on load, shows nowhere else, and Remove transcript clears it",
      ok, JSON.stringify({ err, toast, again, st, after: after && [after.attach, after.removeHidden] }));
    if (!ok) await shot(page, "fail-transcript-unreadable.png");
  }

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-transcript-page-errors.png");

  await viewer.close();
  await laneE();
  for (const dir of [SESSION, FILES]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
  }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n[transcript-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[transcript-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   * " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[transcript-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
