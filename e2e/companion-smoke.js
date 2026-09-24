"use strict";
/*
 * Companion basics e2e smoke (lane V3-V, contract C16). Launches the REAL
 * viewer on a throwaway profile, with the main process's file dialogs
 * replaced (as overview-smoke does). Everything is made in a temp folder.
 *   A blank project (the New menu's "New empty project...", AD-29):
 *     (a) the folder has manifest.json (session_id, source, started_at,
 *         label), an empty events.jsonl and annotations.json; the analysis
 *         gives it one implicit run; the Timeline says in one line that there
 *         is no recording or video, with Attach video; the Steps list says
 *         the whole project is one transaction until the Timeline marks more;
 *     (a2) before the first step, the Steps pane says to add it and the Map
 *         says there are no steps yet;
 *     (b) four steps added by hand (no time, order 1 to 4, the implicit run),
 *         two with a system, one moved down with Alt+Down;
 *     (c) a screenshot from a file and one pasted with Ctrl+V; the pasted one
 *         chosen for the PDD;
 *     (d) a recorder screenshot removed is only hidden (its file stays); an
 *         added one removed leaves the folder, Ctrl+Z brings it back, Ctrl+Y
 *         takes it out again;
 *     (e) two attachments (one on a step), a label edited, Open opens the
 *         copy inside attachments/; (f) a note on a step;
 *     (g) the PDD (word/document.xml): the steps in their order, the systems,
 *         the Attachments section, only the chosen screenshot, no note;
 *     (n) Attach video on its Timeline: offset 0, and the Timeline follows it.
 *   A video project (the New menu's "New project from a video...", a
 *   synthetic video):
 *     (h) the video is copied into video/ (relative path, offset 0) and the
 *         Timeline runs on its length, with no activity bands;
 *     (i) two transactions marked by right-click (Start a transaction here),
 *         applied, and the Steps list then says where each starts; (j) two
 *         steps added at the
 *         playhead; (k) a frame of the video captured as a screenshot; (l) a
 *         note at a moment, in the Notes lane; (m) the PDD carries the steps
 *         and the frame.
 *   Zero page errors. Exits 0 when every check passed, 1 on a failed check,
 *   2 when it could not run.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const VIDEO = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");   // panel-smoke's, made here when absent
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("companion-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");

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

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-companion-"));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#btn-recent-menu", { timeout: T });
  } catch (e) { console.error("[companion-e2e] FATAL:", e); process.exit(2); }
  const app = v.app;

  const session = () => page.evaluate(() => {
    const s = require("./state.js").getSession();
    return s ? { folder: s.sessionFolder, anno: s.annotations, stats: s.stats } : null;
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
  const prompt = async (text) => {
    await page.waitForSelector(".modal-prompt .modal-input", { timeout: T });
    await page.fill(".modal-prompt .modal-input", text);
    await page.click(".modal-prompt .modal-ok");
    await page.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
  };
  const stubOpen = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
  const stubSave = (p) => app.evaluate(({ dialog, shell }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
    shell.showItemInFolder = () => {};
  }, p);
  // AD-29: New is its own menu, beside Open.
  const newProject = async (item) => {
    await page.click("#btn-new-menu");
    await page.click(item);
  };
  const selectStep = async (id) => {
    await page.locator('#step-list .step-row[data-step-id="' + id + '"] .step-name').click({ timeout: T });
    await page.waitForFunction((sid) => require("./state.js").getSelectedStepId() === sid, id, { timeout: T });
    await wait(200);
  };
  const shotMenu = async (src) => {
    await page.locator("#btn-step-add-shot").click({ timeout: T });
    await page.locator('#shot-src-menu [data-src="' + src + '"]').click({ timeout: T });
  };
  const exportPdd = async (tag) => {
    const out = path.join(TMP, tag + ".docx");
    await stubSave(out);
    await page.click("#btn-session-export-menu");
    await page.click("#btn-session-pdd");
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (fs.existsSync(out)) {
        const b = fs.readFileSync(out);
        if (b.length > 1000 && b[0] === 0x50 && b[1] === 0x4b) { await wait(500); return zipFiles(fs.readFileSync(out)); }
      }
      await wait(500);
    }
    throw new Error("no PDD written to " + out);
  };

  // Two small PNG images, made by the page's canvas.
  const PNG_A = path.join(TMP, "shot-a.png"), PNG_B = path.join(TMP, "shot-b.png");
  await page.evaluate((ps) => {
    for (const [p, color] of ps) {
      const c = document.createElement("canvas");
      c.width = 96; c.height = 60;
      const g = c.getContext("2d");
      g.fillStyle = color; g.fillRect(0, 0, 96, 60); g.fillStyle = "#fff"; g.fillRect(10, 10, 30, 20);
      require("fs").writeFileSync(p, Buffer.from(c.toDataURL("image/png").split(",")[1], "base64"));
    }
  }, [[PNG_A, "#2a6"], [PNG_B, "#a26"]]);

  // The synthetic video (32 s, each frame showing its own time), made once.
  if (!fs.existsSync(VIDEO)) {
    await page.evaluate(async (out) => {
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
    }, VIDEO);
  }
  // ================= A. A blank project =================
  const BLANK = path.join(TMP, "Order intake");
  let a = {};
  try {
    await stubSave(BLANK);
    await newProject("#btn-new-blank");
    await opened(BLANK);
    await settled();
    a.manifest = readJson(path.join(BLANK, "manifest.json"));
    a.events = fs.readFileSync(path.join(BLANK, "events.jsonl"), "utf8");
    a.annoExists = fs.existsSync(path.join(BLANK, "annotations.json"));
    const s = await session();
    a.runs = (s.stats.case_stats || []).map((c) => ({ id: c.case_id, implicit: c.implicit }));
    await level("flow");
    a.timeline = await page.evaluate(() => ({ text: ((document.getElementById("tl-empty") || {}).textContent || "").trim(),
      attach: !!document.getElementById("btn-tl-attach-video") }));
    await level("steps");
    a.steps = await page.evaluate(() => ({
      title: ((document.querySelector("#session-layout-steps .editor-list-pane .editor-pane-title") || {}).textContent || "").replace(/\s+/g, " ").trim(),
      note: ((document.getElementById("runs-pane-note") || {}).textContent || "").trim() }));
  } catch (e) { a.err = errText(e); }
  record("(a) New empty project: manifest (session_id, source blank, started_at, label), an empty events.jsonl and annotations.json; one implicit run after the analysis; the Timeline says in one line there is no recording or video, with Attach video; the Steps list says the whole project is one transaction (AD-29)",
    !a.err && JSON.stringify(Object.keys(a.manifest)) === '["session_id","source","started_at","label"]' &&
      a.manifest.source === "blank" && a.manifest.label === "Order intake" && a.events === "" && a.annoExists &&
      a.runs.length === 1 && a.runs[0].implicit === true && /^No recording and no video in this project\. /.test(a.timeline.text) && a.timeline.attach &&
      a.steps.title === "Transactions · 1" &&
      a.steps.note === "The whole project is one transaction until you mark where each one starts on the Timeline.",
    JSON.stringify(a));
  const implicitId = a.runs && a.runs[0] && a.runs[0].id;

  // (a2) Before the first step: the Steps pane and the Map give the reason
  // that holds (no steps yet), never the one meant for other transactions
  // or for a recording without markers.
  let a2 = {};
  try {
    await level("steps");
    a2.guide = await page.evaluate(() => ((document.getElementById("step-detail") || {}).textContent || "").replace(/\s+/g, " ").trim());
    await level("map");
    a2.map = await page.evaluate(() => ((document.getElementById("session-map-dfg-host") || {}).textContent || "").replace(/\s+/g, " ").trim());
  } catch (e) { a2.err = errText(e); }
  record("(a2) Before the first step: the Steps pane says Add the first step with + Add step, and the Map says there are no steps yet (not that the transactions are not marked)",
    !a2.err && a2.guide === "Add the first step with + Add step." &&
      a2.map === "No steps yet: add steps in Steps to build the map." && !/marked|reference/i.test(a2.guide + " " + a2.map),
    JSON.stringify(a2));

  // (b) Four steps added by hand, two systems, one moved down.
  const NAMES = ["Receive the order email", "Check the customer", "Enter the sales order", "Send the confirmation"];
  let b = {};
  try {
    await level("steps");
    for (const n of NAMES) {
      await page.click("#btn-add-manual-step");
      await prompt(n);
      await page.waitForFunction((name) => [...document.querySelectorAll("#step-list .step-row .step-name")].some((x) => x.textContent === name), n, { timeout: T });
    }
    let s = await session();
    const byName = (nm) => s.anno.steps.find((x) => x.name === nm);
    b.added = NAMES.map((n) => { const st = byName(n); return st && { order: st.order, time: st.time_range, case: st.case_id === implicitId, state: st.state }; });
    for (const [n, sys] of [[NAMES[0], "Outlook"], [NAMES[2], "SAP"]]) {
      await selectStep(byName(n).step_id);
      await page.fill("#step-system", sys);
      await page.press("#step-system", "Enter");
      await page.waitForFunction(([id, v]) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === id) || {}).system === v,
        [byName(n).step_id, sys], { timeout: T });
    }
    await selectStep(byName(NAMES[1]).step_id);
    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForFunction((id) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === id) || {}).order === 3,
      byName(NAMES[1]).step_id, { timeout: T });
    s = await session();
    b.systems = NAMES.map((n) => byName(n).system || null);
    b.orders = NAMES.map((n) => byName(n).order);
    b.list = await page.evaluate(() => [...document.querySelectorAll("#step-list .run-group.open .step-row .step-name")].map((x) => x.textContent));
    b.onDisk = readJson(path.join(BLANK, "annotations.json")).steps.map((x) => [x.name, x.order, x.system || null]);
  } catch (e) { b.err = errText(e); }
  const ORDERED = [NAMES[0], NAMES[2], NAMES[1], NAMES[3]];
  record("(b) + Add step makes steps without a time, ordered 1 to 4 in the implicit run; the System field sets two systems; Alt+Down moves a step and rewrites the order",
    !b.err && b.added.every((x, i) => x && x.order === i + 1 && x.time === null && x.case && x.state === "manually_authored") &&
      JSON.stringify(b.systems) === '["Outlook",null,"SAP",null]' && JSON.stringify(b.orders) === "[1,3,2,4]" &&
      JSON.stringify(b.list) === JSON.stringify(ORDERED),
    JSON.stringify(b));

  // (c) A screenshot from a file, one pasted; the pasted one for the PDD.
  let c = {};
  let s0 = await session();
  const stepId = (n) => ((s0.anno.steps || []).find((x) => x.name === n) || {}).step_id;
  try {
    await selectStep(stepId(NAMES[0]));
    await stubOpen(PNG_A);
    await shotMenu("file");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 1, null, { timeout: T });
    await app.evaluate(({ clipboard, nativeImage }, p) => clipboard.writeImage(nativeImage.createFromPath(p)), PNG_B);
    await page.click("#step-shots-sect .step-sect-title");
    await page.keyboard.press("Control+V");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 2, null, { timeout: T });
    const shots = (await session()).anno.analyst_screenshots;
    c.shots = shots.map((x) => ({ source: x.source, file: x.file, onStep: x.step_id === stepId(NAMES[0]),
      exists: fs.existsSync(path.join(BLANK, "screenshots", "analyst", x.file)) }));
    const pasted = shots.find((x) => x.source === "paste");
    await page.locator('#step-detail .step-shot-card[data-ref="' + pasted.id + '"] [data-shot-act="pdd"]').click({ timeout: T });
    await page.waitForFunction((id) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.pdd_screenshot) || {}).pdd_screenshot === id,
      pasted.id, { timeout: T });
    c.cards = await page.evaluate(() => [...document.querySelectorAll("#step-detail .step-shot-card")].map((x) =>
      ({ ref: x.dataset.ref, loaded: (x.querySelector("img") || {}).naturalWidth > 0, pdd: (x.querySelector('[data-shot-act="pdd"]') || {}).textContent })));
    c.pastedId = pasted.id;
  } catch (e) { c.err = errText(e); }
  record("(c) Add screenshot from a file and by Ctrl+V in the step pane: two analyst screenshots on the step (files in screenshots/analyst/); Use in PDD marks the pasted one",
    !c.err && c.shots.length === 2 && c.shots.every((x) => x.exists && x.onStep) &&
      JSON.stringify(c.shots.map((x) => x.source)) === '["file","paste"]' && c.cards.length === 2 && c.cards.every((x) => x.loaded) &&
      c.cards.find((x) => x.ref === c.pastedId).pdd === "In the PDD",
    JSON.stringify(c));
  await page.screenshot({ path: path.join(__dirname, "companion-smoke-steps.png") }).catch(() => {});

  // (d) Removing: a recorder screenshot is hidden, an added one leaves the folder (Undo, Redo).
  let d = {};
  try {
    fs.mkdirSync(path.join(BLANK, "screenshots"), { recursive: true });
    fs.copyFileSync(PNG_A, path.join(BLANK, "screenshots", "rec-1.png"));
    const second = stepId(NAMES[1]);
    // A recorder-style screenshot on the second step (a blank project has none of its own).
    await page.evaluate(async (sid) => {
      const S = require("./session.js");
      const anno = S.ensureAnnoShape(require("./state.js").getSession().annotations);
      anno.steps.find((x) => x.step_id === sid).evidence.screenshot_refs = ["screenshots/rec-1.png"];
      await S.persistAnnotations(anno, "fixture: a recorder screenshot");
    }, second);
    await selectStep(second);
    await page.locator('#step-detail .step-shot-card[data-ref="screenshots/rec-1.png"] [data-shot-act="remove"]').click({ timeout: T });
    await page.waitForSelector("#step-detail .step-unhide-shots", { timeout: T });
    d.hidden = ((await session()).anno.steps.find((x) => x.step_id === second) || {}).hidden_screenshots;
    d.recFile = fs.existsSync(path.join(BLANK, "screenshots", "rec-1.png"));
    // An added screenshot on the third step, removed, then Undo and Redo.
    await selectStep(stepId(NAMES[2]));
    await stubOpen(PNG_A);
    await shotMenu("file");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 3, null, { timeout: T });
    const third = (await session()).anno.analyst_screenshots[2];
    const file = path.join(BLANK, "screenshots", "analyst", third.file);
    d.added = fs.existsSync(file);
    await page.locator('#step-detail .step-shot-card[data-ref="' + third.id + '"] [data-shot-act="remove"]').click({ timeout: T });
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 2, null, { timeout: T });
    d.removed = { entry: (await session()).anno.analyst_screenshots.some((x) => x.id === third.id), file: fs.existsSync(file) };
    await page.click("#step-detail .step-sect-title");
    await page.keyboard.press("Control+Z");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 3, null, { timeout: T });
    d.undone = { entry: true, file: fs.existsSync(file) };
    await page.keyboard.press("Control+Y");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 2, null, { timeout: T });
    d.redone = { file: fs.existsSync(file) };
  } catch (e) { d.err = errText(e); }
  record("(d) Remove: a recorder screenshot is only taken off the step (hidden_screenshots, its file stays, Show hidden screenshots offered); an added one leaves with its file, Ctrl+Z brings both back, Ctrl+Y takes them out again",
    !d.err && JSON.stringify(d.hidden) === '["screenshots/rec-1.png"]' && d.recFile && d.added &&
      !d.removed.entry && !d.removed.file && d.undone.file && !d.redone.file,
    JSON.stringify(d));

  // (e) Attachments, (f) a note on a step.
  let e = {};
  const MAIL = path.join(TMP, "order-email.txt"), SHEET = path.join(TMP, "input.csv");
  fs.writeFileSync(MAIL, "Dear team, please enter order 4711.");
  fs.writeFileSync(SHEET, "sku,qty\nA-1,4\n");
  try {
    await level("overview");
    await page.evaluate(() => { const d = document.getElementById("ov-doc"); if (d) d.open = true; });
    await stubOpen(MAIL);
    await page.locator("#btn-ov-attach").click({ timeout: T });
    await page.waitForSelector("#ov-attach .att-row", { timeout: T });
    await page.fill("#ov-attach .att-label-input", "Example order email");
    await page.press("#ov-attach .att-label-input", "Tab");
    await page.waitForFunction(() => (((require("./state.js").getSession().annotations.attachments) || [])[0] || {}).label === "Example order email", null, { timeout: T });
    await level("steps");
    await selectStep(stepId(NAMES[2]));
    await stubOpen(SHEET);
    await page.locator("#btn-step-attach").click({ timeout: T });
    await page.waitForSelector("#step-atts-sect .att-row", { timeout: T });
    await app.evaluate(({ shell }) => { global.__opened = []; shell.openPath = async (p) => { global.__opened.push(p); return ""; }; });
    await page.locator("#step-atts-sect [data-att-act=open]").click({ timeout: T });
    await wait(500);
    e.opened = await app.evaluate(() => global.__opened);
    e.atts = (await session()).anno.attachments.map((x) => ({ file: x.file, label: x.label, onStep: !!x.step_id,
      copied: fs.existsSync(path.join(BLANK, "attachments", x.file)) }));
    // (f) a note on the step.
    await page.locator("#btn-step-add-note").click({ timeout: T });
    await prompt("Ask Ana whether the credit check is still needed");
    await page.waitForSelector("#step-notes-sect .step-note", { timeout: T });
    e.notes = (await session()).anno.analyst_notes.map((n) => ({ onStep: n.step_id === stepId(NAMES[2]), at: n.at, text: n.text }));
  } catch (x) { e.err = errText(x); }
  record("(e) Attachments: Add file on the Overview (label edited) and Attach file in the step pane copy the files into attachments/; Open opens the copy inside the session folder",
    !e.err && e.atts.length === 2 && e.atts.every((x) => x.copied) && e.atts[0].label === "Example order email" && !e.atts[0].onStep &&
      e.atts[1].onStep && e.atts[1].file === "input.csv" && e.opened.length === 1 &&
      path.resolve(e.opened[0]) === path.resolve(BLANK, "attachments", "input.csv"),
    JSON.stringify(e));
  record("(f) a note on a step goes to annotations.analyst_notes (step_id, no moment) and shows in the step pane",
    !e.err && e.notes && e.notes.length === 1 && e.notes[0].onStep && e.notes[0].at === null, JSON.stringify(e.notes || e.err));

  // (g) The PDD.
  let g = {};
  try {
    const files = await exportPdd("blank");
    const xml = files["word/document.xml"].toString("utf8");
    const media = new Set(Object.keys(files).filter((n) => n.startsWith("word/media/")).map((n) => sha1(files[n])));
    const shots = (await session()).anno.analyst_screenshots;
    const hashOf = (x) => sha1(fs.readFileSync(path.join(BLANK, "screenshots", "analyst", x.file)));
    g.order = ORDERED.map((n, k) => xml.indexOf(">" + (k + 1) + ". " + n + "<"));
    g.systems = ["Outlook", "SAP"].map((x) => xml.includes(x));
    g.attach = ["Attachments", "Example order email", "order-email.txt", "input.csv"].map((x) => xml.includes(x));
    g.chosen = media.has(hashOf(shots.find((x) => x.id === c.pastedId)));
    g.notChosen = media.has(hashOf(shots.find((x) => x.source === "file")));
    g.hiddenRec = media.has(sha1(fs.readFileSync(path.join(BLANK, "screenshots", "rec-1.png"))));
    g.note = xml.includes("credit check is still needed");
  } catch (x) { g.err = errText(x); }
  record("(g) the PDD (word/document.xml) lists the steps in their order, names the systems set by hand, ends with the Attachments section (labels and files), prints only the screenshot chosen for the PDD (not the other added one, not the hidden recorder one) and no note",
    !g.err && g.order.every((i) => i > 0) && g.order.every((i, k) => k === 0 || i > g.order[k - 1]) &&
      g.systems.every(Boolean) && g.attach.every(Boolean) && g.chosen && !g.notChosen && !g.hiddenRec && !g.note,
    JSON.stringify(g));

  // (n) Attach video on the blank project's Timeline.
  let n = {};
  try {
    await level("flow");
    await stubOpen(VIDEO);
    await page.locator("#btn-tl-attach-video").click({ timeout: T });
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 60000 });
    n.video = readJson(path.join(BLANK, "annotations.json")).external_video;
    n.copied = fs.existsSync(path.join(BLANK, "video", path.basename(VIDEO)));
    n.tl = await page.evaluate(() => ({ empty: !!document.getElementById("tl-empty"), sync: document.getElementById("btn-sync-video").hidden }));
  } catch (x) { n.err = errText(x); }
  record("(n) Attach video on a blank project's Timeline: the video is copied in, starts with the session (offset 0, no sync to do) and the Timeline follows it",
    !n.err && n.video.path === "video/" + path.basename(VIDEO) && n.video.offset_ms === 0 && n.copied && !n.tl.empty && n.tl.sync,
    JSON.stringify(n));

  // ================= B. A video project =================
  const VPROJ = path.join(TMP, "Order call");
  let h = {};
  const spanOf = () => page.evaluate(() => require("./views/flow-view-video.js").timelineSpan());
  try {
    await stubOpen(VIDEO);
    await stubSave(VPROJ);
    await newProject("#btn-new-from-video");
    await opened(VPROJ);
    await settled();
    await level("flow");
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 30000 });
    h.manifest = readJson(path.join(VPROJ, "manifest.json"));
    h.video = readJson(path.join(VPROJ, "annotations.json")).external_video;
    h.copied = fs.existsSync(path.join(VPROJ, "video", path.basename(VIDEO))) &&
      fs.statSync(path.join(VPROJ, "video", path.basename(VIDEO))).size === fs.statSync(VIDEO).size;
    h.span = await spanOf();
    h.tl = await page.evaluate(() => ({ bands: document.querySelectorAll("#timeline .tl-activity").length,
      ticks: document.querySelectorAll("#timeline .tl-flow-tick-label").length,
      summary: document.getElementById("timeline-summary").textContent, sync: document.getElementById("btn-sync-video").hidden,
      step: !document.getElementById("btn-add-step").hidden }));
  } catch (x) { h.err = errText(x); }
  record("(h) New project from a video: the video is copied into video/ and stored relative with offset 0 (manifest source video); the Timeline runs on the video's length with no activity bands, and no Sync video",
    !h.err && h.manifest.source === "video" && h.video.path === "video/" + path.basename(VIDEO) && h.video.offset_ms === 0 && h.copied &&
      h.span && Math.abs((h.span.endMs - h.span.startMs) - 31900) < 2500 && h.tl.bands === 0 && h.tl.ticks > 2 && h.tl.sync && h.tl.step,
    JSON.stringify(h));
  await page.screenshot({ path: path.join(__dirname, "companion-smoke-video.png") }).catch(() => {});

  // (i) Two transactions marked by right-click, applied.
  // A point on the Timeline's background at `frac` of its width: in the low
  // lane under the run bands (a run band has a menu of its own).
  const at = async (frac) => page.evaluate((f) => {
    const r = document.getElementById("timeline").getBoundingClientRect();
    const band = document.querySelector("#timeline .tl-case-band");
    return { x: r.left + f * r.width, y: band ? band.getBoundingClientRect().bottom + 14 : r.top + 34 };
  }, frac);
  const rightClickItem = async (frac, label) => {
    const p = await at(frac);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await page.locator("#tl-ctx-menu div", { hasText: label }).click({ timeout: T });
  };
  let i = {};
  try {
    for (const [f, label] of [[0.1, "Order A"], [0.55, "Order B"]]) {
      await rightClickItem(f, "Start a transaction here");
      await prompt(label);
    }
    await page.locator("#btn-apply-marker-edits").click({ timeout: T });
    await page.waitForFunction(() => { const s = require("./state.js").getSession();
      return ((s.stats && s.stats.case_stats) || []).length === 2 && !document.getElementById("run-status"); }, null, { timeout: 120000 });
    i.runs = ((await session()).stats.case_stats || []).map((r) => ({ label: r.label, implicit: !!r.implicit }));
    await level("steps");
    i.note = await page.evaluate(() => ((document.getElementById("runs-pane-note") || {}).textContent || "").trim());
    i.titles = await page.$$eval("#step-list .run-group .run-title", (els) => els.map((e) => (e.textContent || "").trim()));
  } catch (x) { i.err = errText(x); }
  record("(i) two transactions marked by right-click on the video's Timeline (Start a transaction here) and applied: the implicit run gives way to two, listed as Transaction 1 and 2, and the Steps list says each starts where it was marked",
    !i.err && JSON.stringify(i.runs) === '[{"label":"Order A","implicit":false},{"label":"Order B","implicit":false}]' &&
      JSON.stringify(i.titles) === '["Transaction 1","Transaction 2"]' &&
      i.note === "One pass through the process: each starts where you marked it on the Timeline.", JSON.stringify(i));

  // (j) Two steps added at the playhead.
  let j = {};
  try {
    await level("flow");
    for (const sec of [8, 24]) {
      await page.evaluate((t) => { const vd = document.getElementById("video"); vd.pause(); vd.currentTime = t; }, sec);
      await wait(400);
      const n = ((await session()).anno.steps || []).length;
      await page.locator("#btn-add-step").click({ timeout: T });
      await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k + 1, n, { timeout: T });
    }
    const s = await session();
    const start = Date.parse(readJson(path.join(VPROJ, "manifest.json")).started_at);
    const runs = (s.stats.case_stats || []).map((r) => ({ id: r.case_id, a: Date.parse(r.start_ts), b: r.end_ts ? Date.parse(r.end_ts) : null }));
    j.steps = s.anno.steps.map((x) => ({ from: (Date.parse(x.time_range.start) - start) / 1000, to: (Date.parse(x.time_range.end) - start) / 1000,
      run: runs.findIndex((r) => r.id === x.case_id), state: x.state }));
    j.runEnd = (runs[0].b - start) / 1000;
    j.videoEnd = (h.span.endMs - start) / 1000;
  } catch (x) { j.err = errText(x); }
  record("(j) + Step at the playhead adds a step from the playhead to the end of its run (the first run's end, the video's end for the open run)",
    !j.err && j.steps.length === 2 && Math.abs(j.steps[0].from - 8) < 0.6 && Math.abs(j.steps[0].to - j.runEnd) < 0.6 && j.steps[0].run === 0 &&
      Math.abs(j.steps[1].from - 24) < 0.6 && Math.abs(j.steps[1].to - j.videoEnd) < 0.6 && j.steps[1].run === 1 &&
      j.steps.every((x) => x.state === "manually_authored"),
    JSON.stringify(j));

  // (k) A frame of the video as a screenshot of the first step.
  let k = {};
  try {
    await level("steps");
    const first = (await session()).anno.steps.slice().sort((x, y) => Date.parse(x.time_range.start) - Date.parse(y.time_range.start))[0];
    await page.evaluate(() => { const b = document.querySelector("#step-list .run-group:not(.open) .run-row"); if (b && !document.querySelector("#step-list .run-group.open .step-row")) b.click(); });
    await selectStep(first.step_id);
    await page.waitForSelector("#step-panel:not([hidden]) #sp-video[src]", { timeout: T });
    await page.evaluate(() => new Promise((res) => {
      const sp = document.getElementById("sp-video");
      sp.addEventListener("seeked", res, { once: true });
      sp.currentTime = 10;
    }));
    await shotMenu("video_frame");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === 1, null, { timeout: T });
    const shot = (await session()).anno.analyst_screenshots[0];
    const buf = fs.readFileSync(path.join(VPROJ, "screenshots", "analyst", shot.file));
    k.shot = { source: shot.source, at: shot.at, onStep: shot.step_id === first.step_id, png: buf[0] === 0x89 && buf[1] === 0x50, bytes: buf.length,
      atSec: (Date.parse(shot.at) - Date.parse(readJson(path.join(VPROJ, "manifest.json")).started_at)) / 1000 };
    k.frameHash = sha1(buf);
  } catch (x) { k.err = errText(x); }
  record("(k) Add screenshot, A frame of the video: the panel's video frame is saved as a PNG under screenshots/analyst/ with its moment",
    !k.err && k.shot.source === "video_frame" && k.shot.onStep && k.shot.png && k.shot.bytes > 500 && Math.abs(k.shot.atSec - 10) < 0.5,
    JSON.stringify(k.shot || k.err));

  // (l) A note at a moment, in the Notes lane.
  let l = {};
  try {
    await level("flow");
    await rightClickItem(0.3, "Add note here");
    await prompt("The SME pauses to call the warehouse here");
    await page.waitForSelector("#timeline .tl-note", { timeout: T });
    const n = (await session()).anno.analyst_notes;
    l.note = n.map((x) => ({ step: x.step_id, at: !!x.at }));
    l.lane = await page.evaluate(() => ({ pins: document.querySelectorAll("#timeline .tl-note").length,
      row: !document.getElementById("lane-notes-row").hidden, legend: getComputedStyle(document.querySelector("#timeline-legend .lg-note")).display }));
  } catch (x) { l.err = errText(x); }
  record("(l) right-click on the Timeline, Add note here: a note pinned to that moment (analyst_notes, no step), drawn in the Notes lane, listed in the Lanes menu and the legend",
    !l.err && JSON.stringify(l.note) === '[{"step":null,"at":true}]' && l.lane.pins === 1 && l.lane.row && l.lane.legend !== "none",
    JSON.stringify(l));
  await page.screenshot({ path: path.join(__dirname, "companion-smoke-notes.png") }).catch(() => {});

  // (m) The PDD of the video project.
  let m = {};
  try {
    const files = await exportPdd("video");
    const xml = files["word/document.xml"].toString("utf8");
    const media = new Set(Object.keys(files).filter((n) => n.startsWith("word/media/")).map((n) => sha1(files[n])));
    m.steps = ((await session()).anno.steps || []).map((x) => xml.includes(x.name));
    m.frame = media.has(k.frameHash);
    m.note = xml.includes("calls the warehouse");
  } catch (x) { m.err = errText(x); }
  record("(m) the video project's PDD carries its steps and the captured frame, and no note",
    !m.err && m.steps.length === 2 && m.steps.every(Boolean) && m.frame && !m.note, JSON.stringify(m));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[companion-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[companion-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
