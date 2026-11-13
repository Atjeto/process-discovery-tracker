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
 *         the whole project is one transaction and, with no video to mark
 *         more on, to attach one first (lane FX4);
 *     (a2) before the first step, the Steps pane says to add it and the Map
 *         says there are no steps yet;
 *     (b) four steps added by hand (no time, order 1 to 4, the implicit run),
 *         two with a system, one moved down with Alt+Down;
 *     (c) a screenshot from a file and one pasted with Ctrl+V; the pasted one
 *         chosen for the PDD; the step panel's row reads what it is (no
 *         time, no play) with its screenshots under a lead;
 *     (d) a recorder screenshot removed is only hidden (its file stays); an
 *         added one removed leaves the folder, Ctrl+Z brings it back, Ctrl+Y
 *         takes it out again;
 *     (e) two attachments (one on a step), a label edited, Open opens the
 *         copy inside attachments/; (f) a note on a step;
 *     (g) the PDD (word/document.xml): the steps in their order, the systems,
 *         the Attachments section, only the chosen screenshot, no note;
 *     (n) Attach video on its Timeline: offset 0, and the Timeline follows it;
 *         the Steps list then says the Timeline marks the transactions.
 *     (w) lane FX2: a step without a time shows the video's start in the
 *         step panel, with one line saying so, and A frame of the video waits
 *         until the video is played to the step's moment; (x) lane FX2: while
 *         the analysis runs, a screenshot, an attachment and a video are
 *         refused before anything is copied into the folder.
 *   A video project (the New menu's "New project from a video...", a
 *   synthetic video):
 *     (h) the video is copied into video/ (relative path, offset 0) and the
 *         Timeline runs on its length, with no activity bands;
 *     (i) two transactions marked by right-click (Start a transaction here),
 *         applied by themselves, and the Steps list then says where each starts; (j) two
 *         steps added at the
 *         playhead; (k) a frame of the video captured as a screenshot; (l) a
 *         note at a moment, in the Notes lane (named at the timeline's left);
 *         (m) the PDD carries the steps and the frame.
 *     (h2) lane FX2: the step panel open on the project before closes as the
 *         video project opens; (z) lane FX2: the frame shows in the
 *         Screenshots lane, the Screenshots list and the gallery; (y) lane
 *         FX2: Add step inside an added step and Merge with next keep the steps
 *         added (Delete, manual tasks on the step map).
 *   Step flow (contract C17), in another empty project with four steps:
 *     (o) each step's Flow line names the step after it ("Then: ...",
 *         "Then: the end" after the last), with Only when and Decision;
 *     (p) "Only when" on step 2; "Go to" step 2 on step 4 (the dropdown lists
 *         the transaction's other steps in order, numbered, and End the
 *         process); "Go to" End the process on step 3; each row reads where it
 *         goes, and annotations.json holds only_when and links with the step
 *         ids; (q) the step panel shows step 4's flow in one line;
 *     (r) the live map draws the Start and End events, the decision (the
 *         condition on the line into step 2, "otherwise" around it), the loop
 *         and the early end, labelled, the labels clear of the boxes and of
 *         each other; (s) Ctrl+Z takes the early end's when, then the link,
 *         back (the map follows), Ctrl+Y redoes both; (t) hiding step 2 drops
 *         the link to it with one toast, and Ctrl+Z brings both back.
 *   Saving and the handover zip, on the video project:
 *     (u) the top bar's save state: Saved (the folder, then the time, in its
 *         tooltip) after an edit; Not saved in the error colour, with the
 *         reason, while annotations.json is read-only, until an edit saves
 *         again (both changes then on disk);
 *     (v) Export, Whole project (.zip): the whole folder, byte for byte (the
 *         video and annotations.json among its entries), as "Order call.zip"
 *         next to it, shown in its folder; a second one is
 *         "Order call (2).zip"; the Help line.
 *   From a video to one zip (E1 to E5), another video project: it opens on
 *     the Timeline; its Checklist reads Add the steps, Write the steps,
 *     Write the document, Hand off, each button landing on its act; no
 *     Confirm anywhere; Hand off... from the Checklist makes the zip (its
 *     root, Start here.txt, the backups and the log left out of the
 *     folder), and the line then names the version and its date.
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
/* C23 (2.0.6): the first video of the chain (external_videos), or the one
   external_video of a project of 2.0.5. */
const firstVideo = (a) => (a && Array.isArray(a.external_videos) && a.external_videos[0]) || (a && a.external_video) || null;
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

/* A .docx's paragraphs and table rows ("a | b"), its entries as zipFiles
   gives them. */
function docxText(files) {
  const xml = files["word/document.xml"].toString("utf8");
  const texts = (part) => (part.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("");
  const rows = (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((tr) =>
    (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(texts).join(" | "));
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, "");
  const paras = (body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(texts).filter(Boolean);
  return { rows, paras };
}

/* The rows of one sheet of an .xlsx (its entries as zipFiles gives them),
   each cell's inline text placed by its column. */
function xlsxRows(files, sheetName) {
  const names = [...files["xl/workbook.xml"].toString("utf8").matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  const i = names.indexOf(sheetName);
  if (i < 0) return { names, rows: null };
  const xml = files["xl/worksheets/sheet" + (i + 1) + ".xml"].toString("utf8");
  const unesc = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  const rows = (xml.match(/<row[ >][\s\S]*?<\/row>/g) || []).map((row) => {
    const out = [];
    for (const c of row.match(/<c [^>]*>[\s\S]*?<\/c>/g) || []) {
      const col = (c.match(/ r="([A-Z]+)\d+"/) || [])[1] || "A";
      const t = c.match(/<t(?: [^>]*)?>([^<]*)<\/t>/) || c.match(/<v>([^<]*)<\/v>/);
      out[col.charCodeAt(0) - 65] = t ? unesc(t[1]) : "";
    }
    return Array.from(out, (x) => (x === undefined ? "" : x));
  });
  return { names, rows };
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
  // Lane MV: the Map opens on the map the PDD prints and analyzes first when
  // the steps are newer than it; showRuns waits for that analysis (and any
  // other), then shows how the transactions ran: the live map the flow checks
  // read (and on which a change analyzes nothing).
  const showRuns = async () => {
    await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
      null, { timeout: 180000 });
    const link = page.locator("#btn-map-show-runs");
    if (await link.isVisible()) await link.click({ timeout: T });
  };
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
  // 2.0.1: a project with attachments exports one zip, a folder holding the
  // PDD and Attachments/ (pdd-zip.js); the PDD inside is what the checks
  // read, and `pddPackage` keeps the zip's entries (null for a lone .docx).
  let pddPackage = null;
  const exportPdd = async (tag) => {
    const out = path.join(TMP, tag + " PDD export");
    await stubSave(out);
    await page.click("#btn-session-export-menu");
    await page.click("#btn-session-pdd");
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (fs.existsSync(out)) {
        const b = fs.readFileSync(out);
        if (b.length > 1000 && b[0] === 0x50 && b[1] === 0x4b) {
          await wait(500);
          const outer = zipFiles(fs.readFileSync(out));
          const inner = Object.keys(outer).find((n) => /^[^/]+\/[^/]+\.docx$/.test(n));
          pddPackage = inner ? outer : null;
          return inner ? zipFiles(outer[inner]) : outer;
        }
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
  record("(a) New empty project: manifest (session_id, source blank, started_at, label), an empty events.jsonl and annotations.json; one implicit run after the analysis; the Timeline says in one line there is no recording or video, with Attach video; the Steps list holds no line explaining what a transaction is (lane no-narration)",
    !a.err && JSON.stringify(Object.keys(a.manifest)) === '["session_id","source","started_at","label"]' &&
      a.manifest.source === "blank" && a.manifest.label === "Order intake" && a.events === "" && a.annoExists &&
      a.runs.length === 1 && a.runs[0].implicit === true && /^No recording and no video in this project\. /.test(a.timeline.text) && a.timeline.attach &&
      a.steps.title === "Transactions · 1" &&
      a.steps.note === "",
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

  // (a3) Lane FX3 (validation pass 3, F16, F22): a project with no recording
  // and no video, before its first step. The Timeline offers no control that
  // needs a drawn timeline (Lanes, the zoom, the bar of the whole length, the
  // video band with a second Attach video, the gallery, Raw events), and (lane
  // PANE) the pane beside it has no Markers tab: its Steps tab says, word for
  // word, how the first step comes in; the Overview has the document and no
  // Observations (2.0.1); Apps outside the process is not offered; Edit as the As-Is map is
  // disabled with its reason, and Export's map image says why at once, with
  // no analysis and no file.
  let a3 = {};
  try {
    await level("flow");
    a3.tl = await page.evaluate(() => {
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
      return {
        // Lane SCREEN: nor the row's Play, clock and marking buttons.
        controls: ["lanes-menu", "btn-zoom-out", "btn-zoom-reset", "btn-zoom-in", "tl-bar-row", "video-pane", "btn-open-gallery",
          "btn-tl-play", "btn-tl-clock", "btn-add-step", "btn-tl-transaction", "btn-tl-note"]
          .filter((id) => shown(document.getElementById(id))),
        raw: shown(document.querySelector(".event-table-host")),
        attach: [...document.querySelectorAll("#session-layout-flow button")].filter((b) => shown(b) && /Attach video/.test(b.textContent)).length,
        markersTab: !!document.querySelector('#tp-tabs [data-anno="markers"]') || !!document.getElementById("markers-list"),
        hint: ((document.querySelector("#tp-steps .tp-hint") || {}).textContent || "").trim(),
        add: [...document.querySelectorAll("#tp-steps .tp-tools button")].map((b) => b.textContent.trim()),
      };
    });
    await level("overview");
    a3.obs = await page.evaluate(() => ({
      host: !!document.getElementById("ov-observations"), doc: !!document.getElementById("ov-doc"),
    }));
    await level("steps");
    a3.apps = await page.evaluate(() => {
      const b = document.getElementById("btn-ignored-apps");
      return !!b && b.getClientRects().length > 0 && getComputedStyle(b).display !== "none";
    });
    await level("map");
    a3.fork = await page.evaluate(() => { const b = document.getElementById("btn-fork-refmap"); return { disabled: b.disabled, title: b.title }; });
    const svgOut = path.join(TMP, "no-steps.svg");
    await stubSave(svgOut);
    await page.evaluate(() => {
      window.__fx3Pills = [];
      const h = document.getElementById("session-pills");
      window.__fx3Obs = new MutationObserver(() => window.__fx3Pills.push(h.textContent));
      window.__fx3Obs.observe(h, { childList: true, subtree: true, characterData: true });
    });
    await page.click("#btn-session-export-menu");
    await page.click("#btn-session-map-svg");
    await page.waitForFunction(() => /No process map to export/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    await wait(600);
    a3.svg = await page.evaluate(() => {
      window.__fx3Obs.disconnect();
      return { toast: (document.getElementById("toast").textContent || "").trim(), pills: window.__fx3Pills.join("|") };
    });
    a3.svgFile = fs.existsSync(svgOut);
  } catch (e) { a3.err = errText(e); }
  record("(a3) lane FX3: no recording and no video: the Timeline offers none of the controls a drawn timeline needs (one Attach video, no Raw events); lane PANE: no Markers tab, the pane's Steps tab says how the first step comes in and offers Paste notes... and Add step; the Overview has the document and no Observations (2.0.1); no Apps outside the process; Edit as the As-Is map disabled with its reason, and the map image export says why at once, with no analysis and no file",
    !a3.err && a3.tl.controls.length === 0 && !a3.tl.raw && a3.tl.attach === 1 &&
      !a3.tl.markersTab && a3.tl.hint === "No steps yet. Add step adds one, and Paste notes... adds one for each line of your notes." &&
      JSON.stringify(a3.tl.add) === JSON.stringify(["Paste notes...", "Add step"]) &&
      !a3.obs.host && a3.obs.doc && !a3.apps &&
      a3.fork.disabled && a3.fork.title === "No map to edit yet: add steps in Steps to build the map." &&
      a3.svg.toast === "No process map to export: the transactions have no steps yet." && !/Updating/.test(a3.svg.pills) && !a3.svgFile,
    JSON.stringify(a3));

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

  // (b2) Lane FX3 (validation pass 3, F16): Split on a step added by hand
  // (no recorded action to split between) says why, in the analyst's words:
  // disabled in the step pane with the reason, left out of the step menu,
  // and its key S says the same; never "interactions". Edit as the As-Is map
  // acts again once there are steps.
  let b2 = {};
  try {
    const s = await session();
    const id = s.anno.steps.find((x) => x.name === NAMES[0]).step_id;
    await selectStep(id);
    // 2.0.1: the recorded actions show in the pane; no action, no scissors.
    b2.btn = await page.evaluate(() => {
      const rec = document.getElementById("step-recorded");
      return rec ? { scissors: rec.querySelectorAll(".si-split-btn").length,
        text: ((rec.querySelector(".evidence") || {}).textContent || "").trim() } : null;
    });
    await page.locator('#step-list .step-row[data-step-id="' + id + '"] .step-name').click({ button: "right", timeout: T });
    await page.waitForSelector("#step-ctx-menu", { timeout: T });
    b2.menu = await page.evaluate(() => [...document.querySelectorAll("#step-ctx-menu > div")].map((x) => (x.textContent || "").trim()).filter(Boolean));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#step-ctx-menu", { state: "detached", timeout: T });
    await page.locator('#step-list .step-row[data-step-id="' + id + '"] .step-name').click({ timeout: T });
    await page.keyboard.press("s");
    await page.waitForFunction(() => /cannot be split/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    b2.toast = await page.evaluate(() => (document.getElementById("toast").textContent || "").trim());
    await level("map");
    b2.fork = await page.evaluate(() => !document.getElementById("btn-fork-refmap").disabled);
    await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
      null, { timeout: 180000 });
    await level("steps");
  } catch (e) { b2.err = errText(e); }
  record("(b2) lane FX3 + 2.0.1: a step added by hand shows no recorded action and no scissors, is not split from the step menu, and S says why; Edit as the As-Is map acts once there are steps",
    !b2.err && !!b2.btn && b2.btn.scissors === 0 && b2.btn.text === "No action was recorded in this step." &&
      b2.menu.length > 0 && !b2.menu.some((t) => /Split/.test(t)) && b2.toast.startsWith("No action was recorded in this step") &&
      !/interaction|\u2265/.test(b2.toast) && b2.fork,
    JSON.stringify(b2));

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
    await page.click("#step-detail .step-state");
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
    // The step panel beside the list (the owner's review): a step added by
    // hand, in a project with no video, reads what it is, with no play.
    // Plan D2: below 1440 px the selection opens no panel (and this project
    // has no video, so no Play): its row is read from the panel opened in
    // code on the same step, as the Steps level draws it.
    c.narrow = await page.evaluate(() => !require("./views/step-panel.js").standsBeside(window.innerWidth));
    if (c.narrow) {
      c.closedOnRow = await page.evaluate(() => document.getElementById("step-panel").hidden);
      await page.evaluate((id) => { const SP = require("./views/step-panel.js");
        SP.openForStep(require("./state.js").getSession().annotations.steps.find((s) => s.step_id === id)); }, stepId(NAMES[0]));
    }
    c.panel = await page.evaluate((id) => {
      const r = document.querySelector('#step-panel:not([hidden]) #sp-body .sp-occ[data-step-id="' + id + '"]');
      return r ? { explain: ((document.getElementById("sp-explain") || {}).textContent || "").trim(), at: ((r.querySelector(".sp-at") || {}).textContent || "").trim(),
        play: !!r.querySelector(".sp-play"), leads: [...r.querySelectorAll(".sp-lead")].map((x) => (x.textContent || "").trim()),
        shots: r.querySelectorAll(".sp-shot").length } : null;
    }, stepId(NAMES[0]));
    if (c.narrow) await page.evaluate(() => require("./views/step-panel.js").close());
  } catch (e) { c.err = errText(e); }
  record("(c) Add screenshot from a file and by Ctrl+V in the step pane: two analyst screenshots on the step (files in screenshots/analyst/), shown in the editor; Use in PDD marks the pasted one; the step panel's row reads \"Transaction 1 · no time\" (lane FX3: nothing recorded) under \"This step happened once in transaction 1.\", no play, and (plan D2) no screenshot: the editor beside it shows them" +
    (c.narrow ? "; below 1440 px the selection opened no panel" : ""),
    !c.err && c.shots.length === 2 && c.shots.every((x) => x.exists && x.onStep) &&
      JSON.stringify(c.shots.map((x) => x.source)) === '["file","paste"]' && c.cards.length === 2 && c.cards.every((x) => x.loaded) &&
      c.cards.find((x) => x.ref === c.pastedId).pdd === "In the PDD" &&
      !!c.panel && c.panel.explain === "This step happened once in transaction 1." && c.panel.at === "Transaction 1 · no time" &&
      !c.panel.play && JSON.stringify(c.panel.leads) === "[]" && c.panel.shots === 0 && (!c.narrow || c.closedOnRow === true),
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
    await page.click("#step-detail .step-state");
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
    // Lane FX1: a step's heading reads "Step N: <name>" (its number never reads as a section's).
    g.order = ORDERED.map((n, k) => xml.indexOf(">Step " + (k + 1) + ": " + n + "<"));
    g.systems = ["Outlook", "SAP"].map((x) => xml.includes(x));
    g.attach = ["Attachments", "Example order email", "order-email.txt", "input.csv"].map((x) => xml.includes(x));
    g.chosen = media.has(hashOf(shots.find((x) => x.id === c.pastedId)));
    g.notChosen = media.has(hashOf(shots.find((x) => x.source === "file")));
    g.hiddenRec = media.has(sha1(fs.readFileSync(path.join(BLANK, "screenshots", "rec-1.png"))));
    g.note = xml.includes("credit check is still needed");
    // 2.0.1: the attachments go with the PDD, and its names link to them.
    g.package = pddPackage ? Object.keys(pddPackage).filter((n) => !n.endsWith("/")).map((n) => n.split("/").slice(1).join("/")).sort() : null;
    const rels = (files["word/_rels/document.xml.rels"] || Buffer.from("")).toString("utf8");
    g.links = [...rels.matchAll(/Target="(Attachments\/[^"]*)"/g)].map((x) => x[1]).sort();
  } catch (x) { g.err = errText(x); }
  record("(g) the PDD (word/document.xml) lists the steps in their order, names the systems set by hand, ends with the Attachments section (labels and files), prints only the screenshot chosen for the PDD (not the other added one, not the hidden recorder one) and no note; 2.0.1: it comes as one zip with its Attachments folder, its names linking there",
    !g.err && g.order.every((i) => i > 0) && g.order.every((i, k) => k === 0 || i > g.order[k - 1]) &&
      g.systems.every(Boolean) && g.attach.every(Boolean) && g.chosen && !g.notChosen && !g.hiddenRec && !g.note &&
      !!g.package && g.package.includes("Attachments/order-email.txt") && g.package.includes("Attachments/input.csv") &&
      g.package.filter((n) => n.endsWith(".docx")).length === 1 &&
      JSON.stringify([...new Set(g.links)].sort()) === JSON.stringify(["Attachments/input.csv", "Attachments/order-email.txt"]),
    JSON.stringify(g));

  // (n) Attach video on the blank project's Timeline.
  let n = {};
  try {
    await level("flow");
    await stubOpen(VIDEO);
    await page.locator("#btn-tl-attach-video").click({ timeout: T });
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 60000 });
    n.video = firstVideo(readJson(path.join(BLANK, "annotations.json")));
    n.copied = fs.existsSync(path.join(BLANK, "video", path.basename(VIDEO)));
    n.tl = await page.evaluate(() => ({ empty: !!document.getElementById("tl-empty"), sync: document.getElementById("btn-sync-video").hidden }));
    // Lane FX4: with the video the Timeline can mark the transactions; the
    // Steps list holds no line explaining it (lane no-narration).
    await level("steps");
    n.note = await page.evaluate(() => ((document.getElementById("runs-pane-note") || {}).textContent || "").trim());
  } catch (x) { n.err = errText(x); }
  record("(n) Attach video on a blank project's Timeline: the video is copied in, starts with the session (offset 0, no sync to do) and the Timeline follows it; the Steps list holds no line explaining the transactions (lane no-narration)",
    !n.err && n.video.path === "video/" + path.basename(VIDEO) && n.video.offset_ms === 0 && n.copied && !n.tl.empty && n.tl.sync &&
      n.note === "",
    JSON.stringify(n));

  // (w) Lane FX2 (validation pass 3, F14): a step without a time, in a
  // project with a video. The step panel shows the video's start with one
  // line saying the step has no time, never the moment the previous step's
  // video was left at; A frame of the video waits, with the reason, until the
  // analyst plays the video to the step's moment, then takes that frame.
  // Lane FX3 (F22): the project has no recording, so the time the step has
  // not is the video's.
  let w = {};
  const UNTIMED = "This step has no time in the video: play the video to its moment, then Add screenshot takes that frame.";
  const spVideo = () => page.evaluate(() => {
    const vd = document.getElementById("sp-video"), note = document.getElementById("sp-video-note");
    return { t: vd.currentTime, hidden: vd.hidden, note: note && !note.hidden ? (note.textContent || "").trim() : "",
      play: !!document.querySelector("#sp-body .sp-play") };
  });
  const seekPanel = (secs) => page.evaluate((t) => new Promise((res) => {
    const vd = document.getElementById("sp-video");
    vd.addEventListener("seeked", () => res(vd.currentTime), { once: true });
    vd.currentTime = t;
  }), secs);
  const shotCount = () => page.evaluate(() => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length);
  const refusal = () => page.waitForFunction(() => /no time in the video: play the step panel's video/.test((document.getElementById("toast") || {}).textContent || ""),
    null, { timeout: T });
  try {
    await level("steps");
    // Plan D2: below 1440 px the selection opens no panel, and a step without
    // a time has no Play: A frame of the video, refused with its reason,
    // opens the panel on the step (in the place of the step list) at the
    // video's start, where it can be played to the step's moment.
    w.narrow = await page.evaluate(() => !require("./views/step-panel.js").standsBeside(window.innerWidth));
    await selectStep(stepId(NAMES[0]));
    if (w.narrow) {
      w.closedOnRow = await page.evaluate(() => document.getElementById("step-panel").hidden);
      await shotMenu("video_frame");
      await refusal();
    }
    await page.waitForFunction(() => {
      const vd = document.querySelector("#step-panel:not([hidden]) #sp-video[src]");
      return !!(vd && vd.readyState >= 1 && !vd.seeking);
    }, null, { timeout: T });
    w.movedTo = await seekPanel(12);
    if (w.narrow) {
      await page.locator("#btn-sp-close").click({ timeout: T });
      await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
    }
    await selectStep(stepId(NAMES[3]));
    w.before = await shotCount();
    if (w.narrow) {
      await shotMenu("video_frame");
      await refusal();
      w.refused = { toast: await page.evaluate(() => document.getElementById("toast").textContent), count: await shotCount() };
      w.inList = await page.evaluate(() => require("./views/step-panel.js").inList());
    }
    await page.waitForFunction(() => { const vd = document.getElementById("sp-video"); return !vd.seeking && vd.currentTime === 0; }, null, { timeout: T });
    w.next = await spVideo();
    if (!w.narrow) {
      await shotMenu("video_frame");
      await refusal();
      w.refused = { toast: await page.evaluate(() => document.getElementById("toast").textContent), count: await shotCount() };
    }
    w.playedTo = await seekPanel(6);
    await shotMenu("video_frame");
    await page.waitForFunction((k) => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === k + 1, w.before, { timeout: T });
    const shot = (await session()).anno.analyst_screenshots.slice(-1)[0];
    w.shot = { source: shot.source, onStep: shot.step_id === stepId(NAMES[3]),
      atSec: (Date.parse(shot.at) - Date.parse(readJson(path.join(BLANK, "manifest.json")).started_at)) / 1000,
      file: fs.existsSync(path.join(BLANK, "screenshots", "analyst", shot.file)) };
    // The step list back for what follows.
    if (w.narrow) await page.locator("#btn-sp-close").click({ timeout: T });
  } catch (x) { w.err = errText(x); }
  record("(w) lane FX2: a step without a time, in a project with a video: the step panel shows the video's start (not 0:12, where the previous step's video was left) with one line saying the step has no time in the video (lane FX3: never in the recording, which this project has not), and no play; A frame of the video is refused, with the reason, until the video is played to the step's moment, then saves that frame" +
    (w.narrow ? "; plan D2: below 1440 px the selection opens no panel, and the refused frame opens it on the step in the place of the step list" : ""),
    !w.err && Math.abs(w.movedTo - 12) < 0.3 && w.next.t === 0 && !w.next.hidden && w.next.note === UNTIMED && !w.next.play &&
      (!w.narrow || (w.closedOnRow === true && w.inList === true)) &&
      /^This step has no time in the video: play the step panel's video to its moment first, then add the frame\./.test(w.refused.toast) &&
      w.refused.count === w.before && Math.abs(w.playedTo - 6) < 0.3 &&
      w.shot.source === "video_frame" && w.shot.onStep && w.shot.file && Math.abs(w.shot.atSec - 6) < 0.5,
    JSON.stringify(w));

  // (x) Lane FX2 (validation pass 3, F6): while the project's analysis runs,
  // Add screenshot, Attach file and a video copied in are refused before
  // anything is copied into the folder (the entry's save would be refused,
  // and nothing would list the file), each with the reason.
  let xr = {};
  const inBlank = (...sub) => { try { return fs.readdirSync(path.join(BLANK, ...sub)).sort(); } catch (_) { return []; } };
  const blankFiles = () => ({ shots: inBlank("screenshots", "analyst"), atts: inBlank("attachments"), video: inBlank("video") });
  const OTHER_VIDEO = path.join(TMP, "second-video.webm");
  try {
    fs.copyFileSync(VIDEO, OTHER_VIDEO);
    await level("steps");
    await selectStep(stepId(NAMES[2]));
    xr.before = blankFiles();
    await page.evaluate(() => { require("./views/flow-view.js").analyzeSession(); });
    await page.waitForFunction(() => { const r = require("./state.js").getAnalysisRun(); return !!(r && r.status === "running"); }, null, { timeout: T });
    await stubOpen(PNG_B);
    await shotMenu("file");
    await page.waitForFunction(() => /^The screenshot was not added: /.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    xr.shot = await page.evaluate(() => document.getElementById("toast").textContent);
    await stubOpen(SHEET);
    await page.locator("#btn-step-attach").click({ timeout: T });
    await page.waitForFunction(() => /^The file was not attached: /.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    xr.att = await page.evaluate(() => document.getElementById("toast").textContent);
    xr.video = await page.evaluate(([f, vid]) => require("./ipc.js").copyVideoIn({ sessionFolder: f, videoPath: vid }), [BLANK, OTHER_VIDEO]);
    xr.stillRunning = await page.evaluate(() => { const r = require("./state.js").getAnalysisRun(); return !!(r && r.status === "running"); });
    await page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
    await settled();
    xr.after = blankFiles();
  } catch (x) { xr.err = errText(x); }
  const BUSY = "the steps and the map are being updated. Make the change again once the update is done.";
  record("(x) lane FX2: while the project's analysis runs, Add screenshot and Attach file in the step pane and a video copied in are refused before anything is copied into the folder, each saying the steps and the map are being updated",
    !xr.err && xr.stillRunning && xr.shot.startsWith("The screenshot was not added: " + BUSY) && xr.att.startsWith("The file was not attached: " + BUSY) &&
      !!xr.video && xr.video.ok === false && xr.video.code === "ANALYSIS_RUNNING" && xr.video.error === BUSY &&
      JSON.stringify(xr.after) === JSON.stringify(xr.before),
    JSON.stringify(xr));

  // ================= B. A video project =================
  const VPROJ = path.join(TMP, "Order call");
  let h = {};
  const spanOf = () => page.evaluate(() => require("./views/flow-view-video.js").timelineSpan());
  try {
    await stubOpen(VIDEO);
    await stubSave(VPROJ);
    // Lane FX2 (validation pass 3, F3): the step panel open on the empty
    // project's step closes as another project opens. Plan D2: below 1440 px
    // the selection opened none: it is opened in code on the selected step
    // (what is checked here is that it closes).
    await page.evaluate(() => {
      const SP = require("./views/step-panel.js"), S = require("./state.js");
      if (!document.getElementById("step-panel").hidden || SP.standsBeside(window.innerWidth)) return;
      SP.openForStep(S.getSession().annotations.steps.find((s) => s.step_id === S.getSelectedStepId()));
    });
    h.panelBefore = await page.evaluate(() => !document.getElementById("step-panel").hidden);
    await newProject("#btn-new-from-video");
    await opened(VPROJ);
    h.panelAfter = await page.evaluate(() => ({ hidden: document.getElementById("step-panel").hidden }));
    await settled();
    // A project made from a video opens on the Timeline, where its work starts.
    h.levelOpened = await page.evaluate(() => ({ level: require("./state.js").getLevel(),
      lit: (document.querySelector(".view-mode-btn.active") || { dataset: {} }).dataset.level }));
    await level("flow");
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 30000 });
    h.manifest = readJson(path.join(VPROJ, "manifest.json"));
    h.video = firstVideo(readJson(path.join(VPROJ, "annotations.json")));
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
  record("(h2) lane FX2: the step panel, open on a step of the empty project, closes as the video project opens, and the video project opens on the Timeline",
    !h.err && h.panelBefore === true && !!h.panelAfter && h.panelAfter.hidden === true &&
      !!h.levelOpened && h.levelOpened.level === "flow" && h.levelOpened.lit === "flow",
    JSON.stringify({ before: h.panelBefore, after: h.panelAfter, opened: h.levelOpened }));
  await page.screenshot({ path: path.join(__dirname, "companion-smoke-video.png") }).catch(() => {});

  // (h3) Lane FX3: a project made from a video draws its Timeline with its
  // controls but has no Raw events drawer (it has no events); its video
  // never says "loaded"; and a video playing on the Timeline stops when the
  // level changes (validation pass 3, F25), so it never plays on elsewhere.
  let h3 = {};
  try {
    await level("flow");
    h3.state = await page.evaluate(() => {
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
      return {
        controls: ["lanes-menu", "btn-zoom-out", "btn-zoom-reset", "btn-zoom-in", "tl-bar-row"].filter((id) => shown(document.getElementById(id))).length,
        raw: shown(document.querySelector(".event-table-host")),
        overlay: (document.getElementById("video-overlay").textContent || "").trim(),
      };
    });
    await page.evaluate(async () => {
      const v = document.getElementById("video");
      v.muted = true;
      await v.play();
    });
    await wait(700);
    h3.playing = await page.evaluate(() => !document.getElementById("video").paused);
    // Lane SCREEN: the video's corner never shows the video's own time (the
    // row's clock says the moment, on the one clock).
    h3.overlayPlaying = await page.evaluate(() => (document.getElementById("video-overlay").textContent || "").trim());
    await level("overview");
    h3.pausedOnOverview = await page.evaluate(() => document.getElementById("video").paused);
    await level("flow");
  } catch (x) { h3.err = errText(x); }
  record("(h3) lane FX3: a video project's Timeline has its controls and no Raw events (no events), its video never says loaded, and the video stops when the level changes; lane SCREEN: its corner shows no time while it plays",
    !h3.err && h3.state.controls === 5 && !h3.state.raw && !/loaded/.test(h3.state.overlay) && h3.playing && h3.pausedOnOverview &&
      h3.overlayPlaying === "",
    JSON.stringify(h3));

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
    // 2.0.3: a project made from a video applies its marker changes itself.
    await page.waitForFunction(() => { const s = require("./state.js").getSession();
      return ((s.stats && s.stats.case_stats) || []).length === 2 && !document.getElementById("run-status"); }, null, { timeout: 120000 });
    i.runs = ((await session()).stats.case_stats || []).map((r) => ({ label: r.label, implicit: !!r.implicit }));
    await level("steps");
    i.note = await page.evaluate(() => ((document.getElementById("runs-pane-note") || {}).textContent || "").trim());
    i.titles = await page.$$eval("#step-list .run-group .run-title", (els) => els.map((e) => (e.textContent || "").trim()));
  } catch (x) { i.err = errText(x); }
  record("(i) two transactions marked by right-click on the video's Timeline (Start a transaction here), applied by themselves (2.0.3): the implicit run gives way to two, listed as Transaction 1 and 2, and the Steps list says each starts where it was marked",
    !i.err && JSON.stringify(i.runs) === '[{"label":"Order A","implicit":false},{"label":"Order B","implicit":false}]' &&
      JSON.stringify(i.titles) === '["Transaction 1","Transaction 2"]' &&
      i.note === "", JSON.stringify(i));

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
  record("(j) Add step at the playhead adds a step from the playhead to the end of its run (the first run's end, the video's end for the open run)",
    !j.err && j.steps.length === 2 && Math.abs(j.steps[0].from - 8) < 0.6 && Math.abs(j.steps[0].to - j.runEnd) < 0.6 && j.steps[0].run === 0 &&
      Math.abs(j.steps[1].from - 24) < 0.6 && Math.abs(j.steps[1].to - j.videoEnd) < 0.6 && j.steps[1].run === 1 &&
      j.steps.every((x) => x.state === "manually_authored"),
    JSON.stringify(j));

  // (j2) 2.0.1: the Timeline adds a step at a right-click; a step band's
  // right-click deletes a step added by hand (asked first); a band click
  // then Steps shows that step selected, its row in view.
  let j2 = {};
  let newestName = null;
  try {
    await level("flow");
    const n0 = ((await session()).anno.steps || []).length;
    await rightClickItem(0.9, "Add a step here");
    await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k + 1, n0, { timeout: T });
    j2.added = true;
    const newest = (await session()).anno.steps.slice().sort((x, y) => Date.parse(y.time_range.start) - Date.parse(x.time_range.start))[0];
    newestName = newest.name;
    const band = page.locator('.tl-step-band[data-step-id="' + newest.step_id + '"]');
    await band.click({ button: "right", timeout: T });
    j2.items = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu > div")].map((d) => (d.textContent || "").trim()));
    j2.head = await page.evaluate(() => ((document.querySelector("#tl-ctx-menu .tl-ctx-head") || {}).textContent || ""));
    await page.locator("#tl-ctx-menu div", { hasText: /^Delete step$/ }).click({ timeout: T });
    await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
    await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k, n0, { timeout: T });
    j2.deleted = true;
    const target = (await session()).anno.steps.slice().sort((x, y) => Date.parse(x.time_range.start) - Date.parse(y.time_range.start))[0];
    await page.locator('.tl-step-band[data-step-id="' + target.step_id + '"]').click({ timeout: T });
    await level("steps");
    await wait(600);
    j2.shown = await page.evaluate((sid) => {
      const row = document.querySelector('#step-list .step-row.selected[data-step-id="' + sid + '"]');
      return !!row && row.getBoundingClientRect().height > 0;
    }, target.step_id);
  } catch (x) { j2.err = errText(x); }
  record("(j2) 2.0.1: right-click the Timeline, Add a step here adds a step; a step band's right-click marks there first (Add a step here: steps are added one after another, on the band of the one before), then, under the step's name, Open in Steps and Delete step, which deletes it (asked first); a band click then Steps shows that step selected",
    !j2.err && j2.added && j2.items.includes("Add a step here") && j2.head === newestName &&
      JSON.stringify(j2.items.slice(-4)) === JSON.stringify(["Open in Steps", "Play", "Place after a step…", "Delete step"]) &&
      j2.deleted && j2.shown, JSON.stringify(j2));

  // (k) A frame of the video as a screenshot of the first step.
  let k = {};
  try {
    await level("steps");
    const first = (await session()).anno.steps.slice().sort((x, y) => Date.parse(x.time_range.start) - Date.parse(y.time_range.start))[0];
    await page.evaluate(() => { const b = document.querySelector("#step-list .run-group:not(.open) .run-row"); if (b && !document.querySelector("#step-list .run-group.open .step-row")) b.click(); });
    await selectStep(first.step_id);
    // Plan D2: below 1440 px the panel opens on Play only (then paused here,
    // so the frame is the one moved to).
    k.narrow = await page.evaluate(() => !require("./views/step-panel.js").standsBeside(window.innerWidth));
    if (k.narrow) {
      await page.locator("#step-detail #btn-step-watch").click({ timeout: T });
      await page.waitForSelector("#step-panel:not([hidden]) #sp-video[src]", { timeout: T });
      await page.waitForFunction(() => !document.getElementById("sp-video").paused, null, { timeout: T });
      await page.evaluate(() => document.getElementById("sp-video").pause());
    }
    await page.waitForSelector("#step-panel:not([hidden]) #sp-video[src]", { timeout: T });
    await page.evaluate(() => new Promise((res) => {
      const sp = document.getElementById("sp-video");
      sp.addEventListener("seeked", res, { once: true });
      sp.currentTime = 10;
    }));
    // Lane E-1: each step marked on the video took its own frame as it was
    // added; this one is one more, the last entry.
    const had = ((await session()).anno.analyst_screenshots || []).length;
    await shotMenu("video_frame");
    await page.waitForFunction((n) => ((require("./state.js").getSession().annotations.analyst_screenshots) || []).length === n + 1, had, { timeout: T });
    const shot = (await session()).anno.analyst_screenshots[had];
    const buf = fs.readFileSync(path.join(VPROJ, "screenshots", "analyst", shot.file));
    k.shot = { source: shot.source, at: shot.at, onStep: shot.step_id === first.step_id, png: buf[0] === 0x89 && buf[1] === 0x50, bytes: buf.length,
      atSec: (Date.parse(shot.at) - Date.parse(readJson(path.join(VPROJ, "manifest.json")).started_at)) / 1000 };
    k.frameHash = sha1(buf);
  } catch (x) { k.err = errText(x); }
  record("(k) Add screenshot, A frame of the video: the panel's video frame is saved as a PNG under screenshots/analyst/ with its moment",
    !k.err && k.shot.source === "video_frame" && k.shot.onStep && k.shot.png && k.shot.bytes > 500 && Math.abs(k.shot.atSec - 10) < 0.5,
    JSON.stringify(k.shot || k.err));

  // (z) Lane FX2 (validation pass 2, F11; pass 3, F8): the frame added with a
  // moment shows where the recording's screenshots do: a mark in the
  // Timeline's Screenshots lane (its tooltip says you added it, when and on
  // which step), a card in the Screenshots list badged "added", and the
  // gallery's Added by you.
  let z = {};
  try {
    const s = await session();
    const shot = (s.anno.analyst_screenshots || [])[0] || {};
    z.on = (s.anno.steps.find((x) => x.step_id === shot.step_id) || {}).name || "";
    await level("flow");
    // The marker edits of (i) left the Markers tab open beside the video.
    await page.locator('.anno-tab[data-anno="screens"]').click({ timeout: T });
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.locator('#lanes-popup input[data-lane="screenshots"]').check({ timeout: T });
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.waitForSelector("#timeline .tl-screenshot-added", { timeout: T });
    z.lane = await page.evaluate(() => [...document.querySelectorAll("#timeline .tl-screenshot")].map((d) => ({
      added: d.classList.contains("tl-screenshot-added"), title: d.title })));
    z.legend = await page.evaluate(() => getComputedStyle(document.querySelector("#lanes-legend .lg-screenshot")).display);
    z.grid = await page.evaluate(() => [...document.querySelectorAll("#screenshots-grid .thumb")].map((c) => ({
      badge: ((c.querySelector(".badge") || {}).textContent || ""), title: c.title, img: !!c.querySelector("img"),
      shown: c.getClientRects().length > 0 })));
    await page.locator("#btn-open-gallery").click({ timeout: T });
    await page.waitForSelector("#screenshot-gallery", { state: "visible", timeout: T });
    await page.selectOption("#gallery-filter", "added");
    z.gallery = await page.evaluate(() => ({ pos: document.getElementById("gallery-pos").textContent,
      reason: document.getElementById("gallery-reason").textContent,
      options: [...document.querySelectorAll("#gallery-filter option")].map((o) => o.textContent) }));
    await page.locator("#gallery-close").click({ timeout: T });
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.locator('#lanes-popup input[data-lane="screenshots"]').uncheck({ timeout: T });
    await page.locator("#btn-lanes").click({ timeout: T });
  } catch (x) { z.err = errText(x); }
  // Lane E-1: the two steps marked at 0:08 and 0:24 took their frames as they
  // were added (the step added at a right-click and deleted took its frame
  // with it), so the frame of (k) is one of three.
  const zMark = ((z.lane || []).find((x) => /^Added by you, a frame at 0:(09|10), on /.test(x.title || ""))) || {};
  // Lane PANE: the mark's tooltip says, on a line of its own, what a click
  // does (the Screenshots tab at it); its first line is the card's tooltip.
  const zTitle = String(zMark.title || "").split("\n")[0];
  const zClick = /\nClick: show it in the Screenshots tab beside the video, and go to its moment\.$/.test(zMark.title || "");
  record("(z) lane FX2: the frame added with a moment shows where the recording's screenshots do: a mark in the Timeline's Screenshots lane (its tooltip: added by you, when, on which step), a card in the Screenshots list badged added, and in the gallery under Added by you",
    !z.err && !!z.on && z.lane.length === 3 && z.lane.every((x) => x.added) && !!zTitle && zTitle.endsWith(", on " + z.on) && zClick &&
      z.legend !== "none" && z.grid.length === 3 && z.grid.every((c) => c.badge === "added" && c.img && c.shown) && z.grid.some((c) => c.title === zTitle) &&
      z.gallery.pos === "1 / 3" && z.gallery.reason === "added by you, on " + z.on && z.gallery.options.includes("Added by you"),
    JSON.stringify(z));

  // (l) A note at a moment, in the Notes lane.
  let l = {};
  try {
    await level("flow");
    await rightClickItem(0.3, "Add note here");
    await prompt("The SME pauses to call the warehouse here");
    await page.waitForSelector("#timeline .tl-note", { timeout: T });
    const n = (await session()).anno.analyst_notes;
    l.note = n.map((x) => ({ step: x.step_id, at: !!x.at }));
    l.lane = await page.evaluate(() => {
      // The lane's name at the left of the timeline, in the pins' row.
      const name = document.querySelector('#tl-lane-names .tl-lane-name[data-lane="notes"]');
      const pin = document.querySelector("#timeline .tl-note");
      const nr = name && name.getBoundingClientRect(), pr = pin && pin.getBoundingClientRect();
      return { pins: document.querySelectorAll("#timeline .tl-note").length,
        row: !document.getElementById("lane-notes-row").hidden, legend: getComputedStyle(document.querySelector("#lanes-legend .lg-note")).display,
        name: name ? (name.textContent || "").trim() : null, title: name ? name.title : null,
        inRow: !!(nr && pr && (nr.top + nr.bottom) / 2 >= pr.top && (nr.top + nr.bottom) / 2 <= pr.bottom) };
    });
  } catch (x) { l.err = errText(x); }
  record("(l) right-click on the Timeline, Add note here: a note pinned to that moment (analyst_notes, no step), drawn in the Notes lane (named Notes at the left, with its tooltip), listed in the Lanes menu and the legend",
    !l.err && JSON.stringify(l.note) === '[{"step":null,"at":true}]' && l.lane.pins === 1 && l.lane.row && l.lane.legend !== "none" &&
      l.lane.name === "Notes" && /^Notes: /.test(l.lane.title || "") && l.lane.inRow,
    JSON.stringify(l));
  await page.screenshot({ path: path.join(__dirname, "companion-smoke-notes.png") }).catch(() => {});

  // (m) The PDD of the video project.
  let m = {};
  try {
    const files = await exportPdd("video");
    const xml = files["word/document.xml"].toString("utf8");
    const media = new Set(Object.keys(files).filter((n) => n.startsWith("word/media/")).map((n) => sha1(files[n])));
    const ms = await session();
    m.steps = (ms.anno.steps || []).map((x) => xml.includes(x.name));
    // Lane E-1: each step took its frame as it was marked, and the PDD prints
    // one screenshot under each step of the reference transaction (its
    // first, none chosen): the frame the step at 0:08 took as it was marked.
    const ref = (ms.anno.steps || []).slice().sort((x, y) => Date.parse(x.time_range.start) - Date.parse(y.time_range.start))[0];
    const printed = (ms.anno.analyst_screenshots || []).find((sh) => ref && sh.step_id === ref.step_id);
    m.frame = !!printed && media.has(sha1(fs.readFileSync(path.join(VPROJ, "screenshots", "analyst", printed.file))));
    m.note = xml.includes("calls the warehouse");
  } catch (x) { m.err = errText(x); }
  record("(m) the video project's PDD carries its steps and the frame its reference step took, and no note",
    !m.err && m.steps.length === 2 && m.steps.every(Boolean) && m.frame && !m.note, JSON.stringify(m));

  // (y) Lane FX2 (validation pass 3, F5): steps the analyst added stay added
  // through Add step at a moment inside one and Merge with next: both halves
  // and the merged step keep Delete (manually_authored), and the step map
  // draws them as manual tasks (no system set).
  let y = {};
  try {
    const start = Date.parse(readJson(path.join(VPROJ, "manifest.json")).started_at);
    const secs = (iso) => Math.round((Date.parse(iso) - start) / 100) / 10;
    const byStart = (p, q) => Date.parse(p.time_range.start) - Date.parse(q.time_range.start);
    const all = (await session()).anno.steps.slice().sort(byStart);
    const whole = all[0];
    const n = all.length;
    await level("flow");
    await page.evaluate((t) => { const vd = document.getElementById("video"); vd.pause(); vd.currentTime = t; }, 12);
    await wait(400);
    await page.locator("#btn-add-step").click({ timeout: T });
    await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k + 1, n, { timeout: T });
    const halves = (await session()).anno.steps.filter((x) => x.case_id === whole.case_id).sort(byStart);
    y.halves = halves.map((x) => ({ state: x.state, from: secs(x.time_range.start), to: secs(x.time_range.end), same: x.step_id === whole.step_id }));
    await level("steps");
    y.deletable = [];
    for (const half of halves) {
      await selectStep(half.step_id);
      y.deletable.push(await page.evaluate(() => { const b = document.getElementById("btn-step-delete"); return !!b && !b.hidden; }));
    }
    await selectStep(halves[0].step_id);
    await page.evaluate(() => { const d = document.querySelector("#step-detail details.step-detail-more"); if (d) d.open = true; });
    await page.locator("#btn-step-merge").click({ timeout: T });
    await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k, n, { timeout: T });
    const merged = (await session()).anno.steps.find((x) => x.step_id === halves[0].step_id) || {};
    y.merged = { state: merged.state, from: secs(merged.time_range.start), to: secs(merged.time_range.end), name: merged.name };
    await selectStep(merged.step_id);
    y.mergedDeletable = await page.evaluate(() => { const b = document.getElementById("btn-step-delete"); return !!b && !b.hidden; });
    // The step map, once the Map has analyzed the changed steps.
    const BPMN = path.join(VPROJ, "process_map_step.bpmn");
    const annoAt = fs.statSync(path.join(VPROJ, "annotations.json")).mtimeMs;
    await level("map");
    const by = Date.now() + 180000;
    while (Date.now() < by && !(fs.existsSync(BPMN) && fs.statSync(BPMN).mtimeMs > annoAt)) await wait(500);
    await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
    const xml = fs.readFileSync(BPMN, "utf8");
    const named = (tag) => [...xml.matchAll(new RegExp("<(?:bpmn:)?" + tag + "\\b[^>]*\\bname=\"([^\"]*)\"", "g"))].map((mm) => mm[1]);
    y.manual = named("manualTask");
    y.plain = named("task");
    y.names = (await session()).anno.steps.map((x) => x.name);
  } catch (x) { y.err = errText(x); }
  record("(y) lane FX2: steps the analyst added stay added: Add step at a moment inside one splits it into two added steps, Merge with next makes one added step of them again; each keeps Delete, and the step map draws them as manual tasks (no system set)",
    !y.err && y.halves.length === 2 && y.halves.every((x) => x.state === "manually_authored") && y.halves[0].same &&
      Math.abs(y.halves[0].to - 12) < 0.6 && Math.abs(y.halves[1].from - 12) < 0.6 &&
      y.deletable.length === 2 && y.deletable.every(Boolean) &&
      y.merged.state === "manually_authored" && Math.abs(y.merged.from - y.halves[0].from) < 0.2 && Math.abs(y.merged.to - y.halves[1].to) < 0.2 &&
      y.mergedDeletable && y.names.length === 2 && y.names.every((nm) => y.manual.includes(nm)) && !y.names.some((nm) => y.plain.includes(nm)),
    JSON.stringify(y));

  // ================= C. Step flow (contract C17) =================
  // The analyst sets the flow while adding steps: a condition and links on
  // steps, drawn by the live map. (The exported PDD's flow lines are the
  // pipeline lane's, checked there.)
  const FLOWP = path.join(TMP, "Flow check");
  const FN = ["Receive the order email", "Check the customer", "Enter the sales order in SAP", "Send the confirmation"];
  const LOOP = "the customer details are missing";
  const ids = {};
  const flowStep = (id) => page.evaluate((sid) => {
    const st = (require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {};
    return { only_when: st.only_when, links: st.links, state: st.state };
  }, id);
  // Wait until the step's flow passes `pred` (read from the page, tested here).
  const untilStep = async (id, pred) => {
    const deadline = Date.now() + T;
    for (;;) {
      const st = await flowStep(id);
      if (pred(st)) return st;
      if (Date.now() > deadline) throw new Error("step " + id + " stayed " + JSON.stringify(st));
      await wait(100);
    }
  };
  const flowPane = () => page.evaluate(() => {
    const sect = document.getElementById("step-flow");
    return sect ? {
      line: ((document.getElementById("step-flow-line") || {}).textContent || "").trim(),
      cond: !!document.getElementById("step-only-when"),
      // 2.0.1: a row is one sentence of fields; the whole sentence is its title.
      rows: [...sect.querySelectorAll(".flow-link")].map((x) => (x.getAttribute("title") || "").trim()),
      acts: [...sect.querySelectorAll(".step-sect-head .link-btn")].map((x) => x.textContent.trim()),
    } : null;
  });
  // The drawn map: its events, and every edge with its label as drawn.
  const flowMap = () => page.evaluate(() => {
    const L = require("./process-map-levels.js");
    const cy = document.getElementById("session-map-dfg-host").__cy;
    if (!cy) return null;
    const nm = (id) => (id === L.START ? "start" : id === L.END ? "end" : id);
    const box = (e) => e.boundingBox({ includeLabels: true, includeMainLabels: true, includeNodes: false, includeEdges: false,
      includeSourceLabels: false, includeTargetLabels: false });
    const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const labelled = cy.edges().filter((e) => !!e.data("label"));
    const overlaps = [];
    labelled.forEach((e) => {
      cy.nodes().forEach((n) => { if (hit(box(e), n.boundingBox({ includeLabels: true }))) overlaps.push(e.data("label") + " / " + nm(n.id())); });
      labelled.forEach((f) => { if (f !== e && hit(box(e), box(f))) overlaps.push(e.data("label") + " / " + f.data("label")); });
    });
    return {
      events: cy.nodes().filter((n) => n.data("kind") === "event").map((n) => nm(n.id())).sort(),
      edges: cy.edges().map((e) => ({ from: nm(e.data("source")), to: nm(e.data("target")), label: e.data("label") || null,
        full: e.data("fullLabel") || null, observed: !!e.data("observed"), drawn: String(e.style("label") || ""),
        dashed: e.style("line-style") === "dashed", font: parseFloat(e.style("font-size")) })),
      // The label boxes the overlap test uses (an empty box would pass it vacuously).
      boxes: labelled.map((e) => { const b = box(e); return [Math.round(b.w), Math.round(b.h)]; }),
      overlaps,
    };
  });
  const edgeIn = (mp, a, b) => ((mp && mp.edges) || []).find((e) => e.from === a && e.to === b) || null;

  let o = {};
  try {
    await stubSave(FLOWP);
    await newProject("#btn-new-blank");
    await opened(FLOWP);
    await settled();
    await level("steps");
    for (const n of FN) {
      await page.click("#btn-add-manual-step");
      await prompt(n);
      await page.waitForFunction((name) => [...document.querySelectorAll("#step-list .step-row .step-name")].some((x) => x.textContent === name), n, { timeout: T });
    }
    const all = (await session()).anno.steps;
    for (const n of FN) ids[n] = (all.find((x) => x.name === n) || {}).step_id;
    o.panes = [];
    for (const n of FN) { await selectStep(ids[n]); o.panes.push(await flowPane()); }
  } catch (x) { o.err = errText(x); }
  record("(o) C17 + 2.0.1: four steps added by hand; each step's Flow line is one line naming the step after it, with Only when and Decision",
    !o.err && o.panes.length === 4 &&
      JSON.stringify(o.panes.map((q) => q && q.line)) === JSON.stringify(["Then: " + FN[1], "Then: " + FN[2], "Then: " + FN[3], "Then: the end"]) &&
      o.panes.every((q) => q && !q.cond && !q.rows.length && JSON.stringify(q.acts) === JSON.stringify(["Only when…", "Decision…", "Place after…"])),
    JSON.stringify(o));

  let p = {};
  try {
    // Only when, on step 2.
    await selectStep(ids[FN[1]]);
    await page.click("#btn-flow-only-when");
    await page.fill("#step-only-when", "the customer is new");
    await page.press("#step-only-when", "Enter");
    await untilStep(ids[FN[1]], (st) => st.only_when === "the customer is new");
    p.step2 = await flowPane();
    // Go to step 2, on step 4: the dropdown lists the other steps and the end.
    await selectStep(ids[FN[3]]);
    await page.click("#btn-flow-go-to");
    p.options = await page.$$eval("#flow-link-to-new option", (os) => os.map((x) => ({ value: x.value, text: x.textContent, disabled: x.disabled })));
    await page.selectOption("#flow-link-to-new", ids[FN[1]]);
    await page.waitForSelector("#flow-link-when-0", { timeout: T });
    await page.fill("#flow-link-when-0", LOOP);
    await page.press("#flow-link-when-0", "Enter");
    await untilStep(ids[FN[3]], (st) => (st.links || []).some((l) => l.when === LOOP));
    p.step4 = await flowPane();
    // Go to End the process, on step 3.
    await selectStep(ids[FN[2]]);
    await page.click("#btn-flow-go-to");
    await page.selectOption("#flow-link-to-new", "end");
    await page.waitForSelector("#flow-link-when-0", { timeout: T });
    await page.fill("#flow-link-when-0", "the order is rejected");
    await page.press("#flow-link-when-0", "Enter");
    await untilStep(ids[FN[2]], (st) => (st.links || []).some((l) => l.when === "the order is rejected"));
    p.step3 = await flowPane();
    await page.screenshot({ path: path.join(__dirname, "companion-smoke-flow-steps.png") }).catch(() => {});
    // annotations.json on disk (written before the pane is drawn again).
    const deadline = Date.now() + T;
    const onDisk = () => {
      const steps = readJson(path.join(FLOWP, "annotations.json")).steps;
      return FN.map((n) => { const st = steps.find((x) => x.step_id === ids[n]) || {};
        return { only_when: st.only_when || null, links: st.links || null, state: st.state }; });
    };
    while (!(p.disk = onDisk())[2].links && Date.now() < deadline) await wait(200);
  } catch (x) { p.err = errText(x); }
  record("(p) C17: Only when on step 2, Go to step 2 on step 4 and Go to End the process on step 3: the dropdown lists the transaction's other steps in order, numbered, and End the process; each row reads where it goes; annotations.json holds only_when and the links by step id, and the steps stay added",
    !p.err && p.step2.cond && p.step2.line === "Then: " + FN[2] &&
      JSON.stringify(p.options.map((x) => x.text)) === JSON.stringify(["Choose a step or the end", "1. Receive the order email",
        "2. Check the customer", "3. Enter the sales order in SAP", "End the process"]) && p.options[0].disabled &&
      JSON.stringify(p.step4.rows) === JSON.stringify(["Goes back to step 2, Check the customer, when " + LOOP]) &&
      JSON.stringify(p.step3.rows) === JSON.stringify(["Ends here when the order is rejected"]) &&
      JSON.stringify(p.disk) === JSON.stringify([
        { only_when: null, links: null, state: "manually_authored" },
        { only_when: "the customer is new", links: null, state: "manually_authored" },
        { only_when: null, links: [{ to: "end", when: "the order is rejected" }], state: "manually_authored" },
        { only_when: null, links: [{ to: ids[FN[1]], when: LOOP }], state: "manually_authored" },
      ]),
    JSON.stringify(p));

  // (q) The step panel: the step's flow in one line. Plan D2: on Steps the
  // editor beside it holds the flow (its rows, checked above), so the panel
  // there has no flow line; on the Map a box opens the panel with it.
  let q = {};
  try {
    await selectStep(ids[FN[3]]);
    await wait(400);
    q.onSteps = await page.evaluate(() => ({ panel: !document.getElementById("step-panel").hidden,
      flow: !!document.querySelector("#step-panel:not([hidden]) #sp-flow"), editor: !!document.querySelector("#step-detail .step-flow") }));
    await level("map");
    await showRuns();
    await page.waitForFunction(() => { const h = document.getElementById("session-map-dfg-host"); return !!(h && h.__cy && h.getClientRects().length); }, null, { timeout: T });
    await page.evaluate((id) => { document.getElementById("session-map-dfg-host").__cy.getElementById(id).emit("tap"); }, FN[3]);
    await page.waitForSelector("#step-panel:not([hidden]) #sp-flow", { timeout: T });
    q.line = await page.evaluate(() => document.getElementById("sp-flow").textContent.trim());
  } catch (x) { q.err = errText(x); }
  record("(q) C17: the step panel on the Map shows the step's flow in one short line; plan D2: on Steps it shows none (the editor's Flow has it)",
    !q.err && q.line === "Goes back to step 2 when " + LOOP && !q.onSteps.flow && q.onSteps.editor, JSON.stringify(q));

  // (r) The live map.
  let r = {};
  try {
    await level("map");
    await showRuns();
    await page.waitForFunction(() => { const h = document.getElementById("session-map-dfg-host"); return !!(h && h.__cy && h.__cy.edges().length && h.getClientRects().length); }, null, { timeout: T });
    await wait(600);
    r = await flowMap();
  } catch (x) { r.err = errText(x); }
  await page.screenshot({ path: path.join(__dirname, "companion-smoke-flow-map.png") }).catch(() => {});
  const into2 = edgeIn(r, FN[0], FN[1]), around2 = edgeIn(r, FN[0], FN[2]), loop = edgeIn(r, FN[3], FN[1]), early = edgeIn(r, FN[2], "end");
  record("(r) C17: the live map draws Start and End, the decision (the condition on the line into step 2, a dashed otherwise around it), the loop back from step 4 and the early end from step 3, each labelled on its line (whole in the tooltip), and no label lies over a box or another label",
    !r.err && JSON.stringify(r.events) === '["end","start"]' && r.edges.length === 8 &&
      into2 && into2.label === "the customer is new" && into2.observed && !into2.dashed &&
      around2 && around2.label === "otherwise" && !around2.observed && around2.dashed &&
      loop && loop.full === LOOP && !loop.observed && loop.dashed &&
      early && early.label === "the order is rejected" && !early.observed && early.dashed &&
      !!edgeIn(r, "start", FN[0]) && !!edgeIn(r, FN[3], "end") &&
      r.edges.filter((e) => e.label).every((e) => e.drawn === e.label && e.font >= 10) &&
      r.boxes.length === 4 && r.boxes.every(([w, h]) => w > 20 && h > 8) && r.overlaps.length === 0,
    JSON.stringify(r));

  // (s) Undo covers every change: the early end's when, then the link.
  let su = {};
  try {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Control+Z");
    await untilStep(ids[FN[2]], (st) => (st.links || []).length === 1 && st.links[0].when === "");
    su.one = await flowStep(ids[FN[2]]);
    await page.keyboard.press("Control+Z");
    await untilStep(ids[FN[2]], (st) => !st.links);
    su.two = await flowStep(ids[FN[2]]);
    await wait(500);
    su.map = edgeIn(await flowMap(), FN[2], "end");
    await page.keyboard.press("Control+Y");
    await untilStep(ids[FN[2]], (st) => (st.links || []).length === 1);
    await page.keyboard.press("Control+Y");
    await untilStep(ids[FN[2]], (st) => (st.links || []).length === 1 && st.links[0].when === "the order is rejected");
    await wait(500);
    su.back = edgeIn(await flowMap(), FN[2], "end");
  } catch (x) { su.err = errText(x); }
  record("(s) C17: Ctrl+Z takes the early end's when back, then its link, and the map loses the path; Ctrl+Y redoes both",
    !su.err && su.one.links[0].to === "end" && su.two.links === undefined && su.map === null &&
      su.back && su.back.label === "the order is rejected",
    JSON.stringify(su));

  // (t) Hiding a step that a link goes to drops the link, said once.
  let t = {};
  try {
    await level("steps");
    await selectStep(ids[FN[1]]);
    await page.evaluate(() => {
      const el = document.getElementById("toast");
      window.__flowToasts = [];
      window.__flowToastObs = new MutationObserver(() => {
        const tx = el.classList.contains("show") ? el.textContent : "";
        if (tx && window.__flowToasts[window.__flowToasts.length - 1] !== tx) window.__flowToasts.push(tx);
      });
      window.__flowToastObs.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    });
    await page.click("#btn-step-hide");
    await untilStep(ids[FN[1]], (st) => st.state === "hidden");
    await wait(500);
    t.toasts = await page.evaluate(() => { window.__flowToastObs.disconnect(); return window.__flowToasts.slice(); });
    t.link = (await flowStep(ids[FN[3]])).links;
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Control+Z");
    await untilStep(ids[FN[1]], (st) => st.state === "manually_authored");
    t.back = (await flowStep(ids[FN[3]])).links;
  } catch (x) { t.err = errText(x); }
  record("(t) C17: hiding step 2 drops step 4's link to it, with one toast that says so; Ctrl+Z brings the step and the link back",
    !t.err && t.link === undefined && t.toasts.length === 1 &&
      t.toasts[0] === "Step hidden. The link to it was removed; Ctrl+Z brings both back." &&
      JSON.stringify(t.back) === JSON.stringify([{ to: ids[FN[1]], when: LOOP }]),
    JSON.stringify(t));
  { // D. its own scope: C above declares the same helper names
  // ================= D. Saving and the handover zip =================
  // (u) The save state in the top bar (save-state.js). Opened again, the
  // project says Saved and names its folder; an edit shows Saved with the
  // time; with annotations.json read-only an edit shows Not saved in the
  // error colour with the reason (the error toast as before), and it stays;
  // writable again, the next edit saves both changes and shows Saved.
  const ANNO = path.join(VPROJ, "annotations.json");
  const saveState = () => page.evaluate(() => {
    const el = document.getElementById("save-state");
    if (!el) return null;
    const probe = document.createElement("span");
    probe.style.color = "var(--bad)";
    document.body.appendChild(probe);
    const bad = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    const had = document.activeElement;
    el.focus();
    const focusable = document.activeElement === el;
    if (had && had.focus) had.focus(); else el.blur();
    return { text: el.textContent, title: el.title, state: el.dataset.state, color: cs.color, bad, focusable,
      shown: cs.display !== "none" && el.getBoundingClientRect().width > 0, inBar: !!el.closest("header.topbar"),
      role: el.getAttribute("role"), live: el.getAttribute("aria-live") };
  });
  const docField = async (key, value) => {
    await level("overview");
    await page.evaluate(() => { const d = document.getElementById("ov-doc"); if (d) d.open = true; });
    const el = page.locator('#ov-doc [data-doc="' + key + '"]');
    await el.fill(value, { timeout: T });
    await el.press("Tab");
  };
  const stateIs = (text, titleRe) => page.waitForFunction(([t, re]) => {
    const el = document.getElementById("save-state");
    return !!el && el.textContent === t && new RegExp(re).test(el.title);
  }, [text, titleRe], { timeout: T });
  const DOC = { purpose: "Hand the order call over to the team", scope: "From the call to the sales order", trigger: "A customer calls the order desk" };
  let o = {};
  const errsBefore = errs.length;
  try {
    // Another project, then this one again: the state starts over.
    await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), BLANK);
    await opened(BLANK);
    await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), VPROJ);
    await opened(VPROJ);
    await settled();
    o.opened = await saveState();
    await docField("purpose", DOC.purpose);
    await stateIs("Saved", "^Saved at ");
    o.saved = await saveState();
    o.savedOnDisk = (readJson(ANNO).document || {}).purpose;
    // A forced write failure: annotations.json read-only.
    fs.chmodSync(ANNO, 0o444);
    const before = fs.readFileSync(ANNO, "utf8");
    await docField("scope", DOC.scope);
    await stateIs("Not saved", "");
    await page.waitForFunction(() => /was not saved/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    o.failed = await saveState();
    o.toast = await page.evaluate(() => document.getElementById("toast").textContent);
    await wait(1500);
    o.stays = (await saveState()).text;
    o.untouched = fs.readFileSync(ANNO, "utf8") === before;
    // Writable again (the failed save's backup copy took the read-only flag too).
    for (const f of fs.readdirSync(VPROJ)) if (/^annotations\.json(\.\d)?$/.test(f)) fs.chmodSync(path.join(VPROJ, f), 0o666);
    await docField("trigger", DOC.trigger);
    await stateIs("Saved", "^Saved at ");
    o.recovered = await saveState();
    const doc = readJson(ANNO).document || {};
    o.onDisk = [doc.purpose, doc.scope, doc.trigger];
  } catch (x) { o.err = errText(x); }
  // The failed save's own console line (session.js) belongs to this check,
  // not to the page errors; anything else still counts there.
  const during = errs.splice(errsBefore);
  o.expectedErrors = during.filter((t) => /\[session\] annotations\.json not saved/.test(t)).length;
  errs.push(...during.filter((t) => !/\[session\] annotations\.json not saved/.test(t)));
  const wantFolder = "Saved to " + path.resolve(VPROJ) + ".";
  record("(u) the save state in the top bar (role status, polite, focusable): the project opened again says Saved and names its folder; an edit shows Saved with the time; " +
    "annotations.json read-only, an edit shows Not saved in the error colour with the reason (the error toast as before), and it stays; writable again, the next edit saves both changes and shows Saved",
    !o.err && o.opened.text === "Saved" && o.opened.title === wantFolder && o.opened.state === "saved" && o.opened.inBar && o.opened.shown &&
      o.opened.role === "status" && o.opened.live === "polite" && o.opened.focusable && o.opened.color !== o.opened.bad &&
      o.saved.text === "Saved" && o.saved.title.endsWith(" to " + path.resolve(VPROJ) + ".") && o.savedOnDisk === DOC.purpose &&
      o.failed.text === "Not saved" && o.failed.state === "failed" && o.failed.color === o.failed.bad &&
      /^Your change was not saved: a file in the project folder is read-only, or another program holds it \(EPERM: /.test(o.failed.title) &&
      /It stays on screen and is saved with your next change once the problem is fixed\.$/.test(o.failed.title) &&
      /was not saved/.test(o.toast) && o.stays === "Not saved" && o.untouched &&
      o.recovered.text === "Saved" && o.recovered.state === "saved" && o.recovered.color !== o.recovered.bad &&
      JSON.stringify(o.onDisk) === JSON.stringify([DOC.purpose, DOC.scope, DOC.trigger]) && o.expectedErrors >= 1,
    JSON.stringify(o));

  // (v) Export, Whole project (.zip): "Order call.zip" next to the folder with
  // the whole folder in it, byte for byte (annotations.json and the video
  // among its entries); Export is busy while it is made, then its folder
  // opens with the zip selected; a second export makes "Order call (2).zip"
  // and leaves the first as it was. Help says how a project is handed over.
  let p = {};
  const ZIP1 = path.join(TMP, "Order call.zip"), ZIP2 = path.join(TMP, "Order call (2).zip");
  const folderFiles = (root) => {
    const out = [];
    (function walk(dir, rel) {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory()) walk(path.join(dir, d.name), rel + d.name + "/");
        else out.push(rel + d.name);
      }
    })(root, path.basename(root) + "/");
    return out.sort();
  };
  const zipVia = async (want) => {
    await page.click("#btn-session-export-menu");
    await page.locator("#btn-session-zip").click({ timeout: T });
    await page.waitForFunction((re) => new RegExp(re).test((document.getElementById("toast") || {}).textContent || ""),
      "^Exported: " + want.replace(/[.()]/g, "\\$&") + " \\(\\d", { timeout: 120000 });
  };
  try {
    await app.evaluate(({ shell }) => { global.__shown = []; shell.showItemInFolder = (f) => { global.__shown.push(f); }; });
    await page.evaluate(() => {
      window.__busy = [];
      const btn = document.getElementById("btn-session-export-menu");
      new MutationObserver(() => window.__busy.push(btn.getAttribute("aria-busy")))
        .observe(btn, { attributes: true, attributeFilter: ["aria-busy"] });
    });
    p.item = await page.evaluate(() => {
      const b = document.getElementById("btn-session-zip");
      // Under its heading, For another analyst.
      let head = b && b.previousElementSibling;
      while (head && !head.classList.contains("project-menu-heading")) head = head.previousElementSibling;
      return b && { text: b.textContent, inExport: !!b.closest("#session-export-popup"),
        heading: head ? head.textContent.trim() : null };
    });
    await zipVia("Order call.zip");
    p.shown = await app.evaluate(() => global.__shown.slice());
    p.busy = await page.evaluate(() => window.__busy.slice());
    const files = zipFiles(fs.readFileSync(ZIP1));
    const inZip = Object.keys(files).filter((n) => !n.endsWith("/")).sort();
    const inFolder = folderFiles(VPROJ);
    p.whole = JSON.stringify(inZip) === JSON.stringify(inFolder);
    p.sameBytes = inZip.every((n) => sha1(files[n]) === sha1(fs.readFileSync(path.join(TMP, ...n.split("/")))));
    p.count = inZip.length;
    p.anno = !!files["Order call/annotations.json"] && (JSON.parse(files["Order call/annotations.json"].toString("utf8")).document || {}).trigger;
    p.video = sha1(files["Order call/video/" + path.basename(VIDEO)] || Buffer.alloc(0)) === sha1(fs.readFileSync(VIDEO));
    p.nextTo = fs.readdirSync(TMP).filter((n) => /^Order call.*\.zip/.test(n)).sort();
    const firstHash = sha1(fs.readFileSync(ZIP1));
    await zipVia("Order call (2).zip");
    p.second = fs.existsSync(ZIP2) && !!zipFiles(fs.readFileSync(ZIP2))["Order call/annotations.json"];
    p.firstKept = sha1(fs.readFileSync(ZIP1)) === firstHash;
    p.itemAfter = await page.evaluate(() => { const b = document.getElementById("btn-session-zip"); return { text: b.textContent, disabled: b.disabled }; });
    p.help = await page.evaluate(() => {
      const t = ((document.querySelector('.help-section[data-section="start"]') || {}).textContent || "").replace(/\s+/g, " ");
      return /Every change you make saves itself to the project folder/.test(t) && /To hand the project to another analyst, use Export, Whole project \(\.zip\)/.test(t);
    });
  } catch (x) { p.err = errText(x); }
  record("(v) Export, Whole project (.zip): 'Order call.zip' next to the folder holds the whole folder byte for byte (annotations.json with the last edit, the video); Export is busy while it is made, " +
    "then its folder opens with the zip selected; a second export makes 'Order call (2).zip' and leaves the first as it was; Help says how a project is handed over",
    !p.err && p.item && p.item.text === "Whole project (.zip)" && p.item.inExport && p.item.heading === "For another analyst" &&
      p.whole && p.sameBytes && p.anno === DOC.trigger && p.video &&
      JSON.stringify(p.nextTo) === '["Order call.zip"]' && p.shown.length === 1 && path.resolve(p.shown[0]) === path.resolve(ZIP1) &&
      JSON.stringify(p.busy) === '["true","false"]' &&
      p.second && p.firstKept && p.itemAfter.text === "Whole project (.zip)" && !p.itemAfter.disabled && p.help,
    JSON.stringify(p));

  // ================= F. Marking a video in the pane beside it (lane E-1, lane PANE) =================
  // A process manager marks a step on the video, names it and describes it
  // in the pane beside it (the step opened in place in its Steps tab, drawn
  // by the Steps editor; the step panel no longer opens on the Timeline), and the step takes its picture by itself:
  // paused, S puts the cursor in the new step's name; playing, S marks the
  // next step and no field takes a key; one Ctrl+Z takes a step and its
  // picture; a step without a picture offers "Use the video at m:ss".
  {
    const FPROJ = path.join(TMP, "Marked call");
    const F = {};
    const shotsDir = path.join(FPROJ, "screenshots", "analyst");
    const steps = async () => ((await session()).anno.steps || []).slice().sort((x, y) => Date.parse(x.time_range.start) - Date.parse(y.time_range.start));
    const shots = async () => (await session()).anno.analyst_screenshots || [];
    const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? { tag: a.tagName, id: a.id || "" } : null; });
    const pausedAt = async (sec) => {
      await page.evaluate((t) => { const vd = document.getElementById("video"); vd.pause(); vd.currentTime = t; }, sec);
      await page.waitForFunction((t) => { const vd = document.getElementById("video");
        return !vd.seeking && vd.readyState >= 2 && Math.abs(vd.currentTime - t) < 0.05; }, sec, { timeout: T });
    };
    // How far an added screenshot's picture is from the video's frame at
    // `sec` (a copy of the video off screen, drawn at the screenshot's size):
    // how many of their pixels differ by more than a quarter of the range
    // (the synthetic video paints its own time, so another moment's frame
    // differs where the digits are).
    const frameDiff = (file, sec) => page.evaluate(async ([png, src, t]) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "file:///" + png.replace(/\\/g, "/"); });
      const w = img.naturalWidth, hgt = img.naturalHeight;
      const c1 = document.createElement("canvas"); c1.width = w; c1.height = hgt;
      c1.getContext("2d").drawImage(img, 0, 0);
      const v = document.createElement("video");
      v.muted = true; v.preload = "auto";
      await new Promise((res, rej) => { v.addEventListener("loadeddata", res, { once: true }); v.addEventListener("error", rej, { once: true }); v.src = "file:///" + src.replace(/\\/g, "/"); });
      await new Promise((res) => { v.addEventListener("seeked", res, { once: true }); v.currentTime = t; });
      const c2 = document.createElement("canvas"); c2.width = w; c2.height = hgt;
      c2.getContext("2d").drawImage(v, 0, 0, w, hgt);
      const a = c1.getContext("2d").getImageData(0, 0, w, hgt).data, b = c2.getContext("2d").getImageData(0, 0, w, hgt).data;
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if ((Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3 > 64) n += 1;
      }
      v.removeAttribute("src");
      return n;
    }, [file, VIDEO, sec]);
    try {
      await stubOpen(VIDEO);
      await stubSave(FPROJ);
      await newProject("#btn-new-from-video");
      await opened(FPROJ);
      await settled();
      await level("flow");
      await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 30000 });
      // (a) Paused at 0:05, S: the pane opens the new step in place, its name
      // focused and selected; typing names it, Enter saves and leaves.
      await pausedAt(5);
      await page.keyboard.press("s");
      await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 1, null, { timeout: T });
      await page.waitForFunction(() => { const a = document.activeElement; return !!a && a.id === "step-name" && !!a.closest("#tp-editor"); }, null, { timeout: T });
      const first = (await steps())[0];
      F.a = await page.evaluate((sid) => {
        const el = document.activeElement;
        return { value: el.value, selected: el.selectionStart === 0 && el.selectionEnd === el.value.length,
          panel: document.getElementById("step-panel").hidden && document.querySelector("#tp-tab-steps").getAttribute("aria-selected") === "true",
          row: (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId === sid,
          shotInRow: document.querySelectorAll("#tp-editor .step-shot-card").length };
      }, first.step_id);
      await page.screenshot({ path: path.join(__dirname, "companion-smoke-mark-paused.png") }).catch(() => {});
      await page.keyboard.type("Take the call");
      await page.keyboard.press("Enter");
      await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).name === "Take the call",
        first.step_id, { timeout: T });
      F.a.afterEnter = await focused();
      // The description written in the pane saves when it is left.
      await page.locator("#tp-editor #step-desc").click({ timeout: T });
      await page.keyboard.type("Note who calls and what they order.");
      await page.locator("#tp-steps .tp-pos").click({ timeout: T });
      await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).description === "Note who calls and what they order.",
        first.step_id, { timeout: T });
      F.a.described = true;
      // (b) Space plays on; two S presses while it plays give two steps and
      // no field takes a key.
      await page.keyboard.press(" ");
      await page.waitForFunction(() => !document.getElementById("video").paused, null, { timeout: T });
      F.b = { played: true };
      await wait(1200);
      await page.keyboard.press("s");
      await wait(900);
      await page.keyboard.press("s");
      await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 3, null, { timeout: T });
      await wait(600);
      F.b.focus = await focused();
      F.b.playing = await page.evaluate(() => !document.getElementById("video").paused);
      await page.evaluate(() => document.getElementById("video").pause());
      const three = await steps();
      F.b.names = three.map((x) => x.name);
      F.b.panelOnNewest = await page.evaluate((sid) => (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId === sid, three[2].step_id);
      F.b.descs = three.map((x) => x.description || "");
      // (c) Each step has one added screenshot at its own moment; the first
      // one's picture is the video's frame at 0:05, not another moment's.
      const all = await shots();
      const start = Date.parse(readJson(path.join(FPROJ, "manifest.json")).started_at);
      F.c = { per: three.map((x) => all.filter((sh) => sh.step_id === x.step_id).length),
        at: three.map((x) => { const sh = all.find((y) => y.step_id === x.step_id); return sh ? Math.round((Date.parse(sh.at) - Date.parse(x.time_range.start))) : null; }),
        source: all.map((sh) => sh.source) };
      const firstShot = all.find((sh) => sh.step_id === first.step_id);
      F.c.firstAt = firstShot ? (Date.parse(firstShot.at) - start) / 1000 : null;
      F.c.diffAt = await frameDiff(path.join(shotsDir, firstShot.file), 5);
      F.c.diffOther = await frameDiff(path.join(shotsDir, firstShot.file), 20);
      // One Ctrl+Z takes the newest step and its picture (the file leaves the
      // folder); Ctrl+Y brings both back.
      const newest = three[2];
      const newestShot = all.find((sh) => sh.step_id === newest.step_id);
      F.c.fileBefore = fs.existsSync(path.join(shotsDir, newestShot.file));
      await page.locator("#tp-steps .tp-pos").click({ timeout: T });
      await page.keyboard.press("Control+z");
      await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 2, null, { timeout: T });
      await wait(500);
      F.c.undone = { shots: (await shots()).length, file: fs.existsSync(path.join(shotsDir, newestShot.file)) };
      await page.keyboard.press("Control+y");
      await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 3, null, { timeout: T });
      await wait(500);
      F.c.redone = { shots: (await shots()).length, file: fs.existsSync(path.join(shotsDir, newestShot.file)) };
      // (d) A step whose picture was removed offers "Use the video at
      // m:ss" in the editor, in Steps and in the pane; one click takes it.
      await level("steps");
      await page.evaluate(() => { const b = document.querySelector("#step-list .run-group:not(.open) .run-row"); if (b && !document.querySelector("#step-list .run-group.open .step-row")) b.click(); });
      await page.locator('#step-list .step-row[data-step-id="' + first.step_id + '"] .step-name').click({ timeout: T });
      await page.waitForFunction((sid) => require("./state.js").getSelectedStepId() === sid, first.step_id, { timeout: T });
      await wait(300);
      F.a.inSteps = await page.evaluate(() => ({ name: (document.getElementById("step-name") || {}).value, desc: (document.getElementById("step-desc") || {}).value }));
      await page.locator('#step-shots-sect .step-shot-card [data-shot-act="remove"]').click({ timeout: T });
      await page.waitForFunction((sid) => !(require("./state.js").getSession().annotations.analyst_screenshots || []).some((x) => x.step_id === sid), first.step_id, { timeout: T });
      await page.waitForSelector("#btn-step-use-video", { timeout: T });
      F.d = { editor: (await page.locator("#btn-step-use-video").textContent()).trim() };
      await page.screenshot({ path: path.join(__dirname, "companion-smoke-use-video.png") }).catch(() => {});
      await page.locator("#btn-step-use-video").click({ timeout: T });
      await page.waitForFunction((sid) => (require("./state.js").getSession().annotations.analyst_screenshots || []).filter((x) => x.step_id === sid).length === 1, first.step_id, { timeout: T });
      F.d.editorAdded = true;
      F.d.linkGone = await page.evaluate(() => !document.getElementById("btn-step-use-video"));
      const second = three[1];
      await page.locator('#step-list .step-row[data-step-id="' + second.step_id + '"] .step-name').click({ timeout: T });
      await page.waitForFunction((sid) => require("./state.js").getSelectedStepId() === sid, second.step_id, { timeout: T });
      await wait(300);
      await page.locator('#step-shots-sect .step-shot-card [data-shot-act="remove"]').click({ timeout: T });
      await page.waitForFunction((sid) => !(require("./state.js").getSession().annotations.analyst_screenshots || []).some((x) => x.step_id === sid), second.step_id, { timeout: T });
      await level("flow");
      await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]')
        .dispatchEvent(new MouseEvent("click", { bubbles: true })), second.step_id);
      await page.waitForSelector("#tp-editor #btn-step-use-video", { timeout: T });
      F.d.panel = (await page.locator("#tp-editor #btn-step-use-video").textContent()).trim();
      F.d.want = "Use the video at " + (() => { const s = Math.floor((Date.parse(second.time_range.start) - start) / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); })();
      await page.locator("#tp-editor #btn-step-use-video").click({ timeout: T });
      await page.waitForFunction((sid) => (require("./state.js").getSession().annotations.analyst_screenshots || []).filter((x) => x.step_id === sid).length === 1, second.step_id, { timeout: T });
      F.d.panelAdded = true;
      await page.waitForSelector("#tp-editor .step-shot-card", { timeout: T });
      F.d.panelShows = await page.evaluate(() => !document.querySelector("#tp-editor #btn-step-use-video"));
    } catch (x) { F.err = errText(x); }
    record("(F1) lane E-1, lane PANE: paused, S adds a step and the pane beside the video opens it in place (the step panel stays closed) with its name focused and selected; typing a name and Enter names it and leaves the field; the description typed in the pane is the step's; Steps then shows both, with no visit to Steps in between",
      !F.err && F.a.value === "Step 1" && F.a.selected && F.a.panel && F.a.row &&
        !!F.a.afterEnter && F.a.afterEnter.tag !== "INPUT" && F.a.afterEnter.tag !== "TEXTAREA" && F.a.described &&
        !!F.a.inSteps && F.a.inSteps.name === "Take the call" && F.a.inSteps.desc === "Note who calls and what they order.",
      JSON.stringify(F.err ? F : F.a));
    record("(F2) lane E-1: after Enter, Space plays the video on; while it plays two S presses in a row give two steps, no field takes a key (the first step keeps its name), nothing takes the focus, the pane shows the newest step, and a new step takes none of the description of the step before it",
      !F.err && !!F.b && F.b.played && F.b.playing && !!F.b.focus && F.b.focus.tag !== "INPUT" && F.b.focus.tag !== "TEXTAREA" &&
        JSON.stringify(F.b.names) === '["Take the call","Step 1","Step 2"]' && F.b.panelOnNewest &&
        JSON.stringify(F.b.descs) === '["Note who calls and what they order.","",""]',
      JSON.stringify(F.b || F.err));
    record("(F3) lane E-1: each step marked on the video has one added screenshot at its own moment; the first one's picture is the video's frame at 0:05 (closer to it than to the frame at 0:20); one Ctrl+Z takes the newest step and its picture, file included, and Ctrl+Y brings both back",
      !F.err && !!F.c && JSON.stringify(F.c.per) === "[1,1,1]" && F.c.at.every((d) => d === 0) && F.c.source.every((x) => x === "video_frame") &&
        Math.abs(F.c.firstAt - 5) < 0.1 && F.c.diffAt < 40 && F.c.diffOther > 200 && F.a.shotInRow === 1 &&
        F.c.fileBefore && F.c.undone.shots === 2 && F.c.undone.file === false && F.c.redone.shots === 3 && F.c.redone.file === true,
      JSON.stringify(F.c || F.err));
    record("(F4) lane E-1: a step without a picture offers \"Use the video at m:ss\" (its start) in the editor in Steps and in the pane beside the video, and one click there adds that frame",
      !F.err && !!F.d && F.d.editor === "Use the video at 0:05" && F.d.editorAdded && F.d.linkGone &&
        F.d.panel === F.d.want && F.d.panelAdded && F.d.panelShows,
      JSON.stringify(F.d || F.err));

    // ================= G. The pane's lists (lane PANE, items 2 to 4) =================
    // In the same project (three steps marked on the video): All steps is the
    // list in the order of the process; Paste notes... adds two steps without
    // a time, the hint counts them and each row offers Starts here; going to
    // a moment and clicking it gives the step its time; a step opened in place
    // has Previous and Next (disabled at the ends), "Step i of n", Steps' own
    // verbs and Open in Steps; Escape goes back to the list, the focus on its
    // row; Up and Down move between the rows and Enter opens one. Notes and
    // Files list what the project holds, and the counts follow.
    const G = {};
    try {
      await level("flow");
      if (await page.locator("#tp-steps .tp-back").count()) await page.locator("#tp-steps .tp-back").click({ timeout: T });
      const list = () => page.evaluate(() => ({
        rows: [...document.querySelectorAll("#tp-steps .tp-row")].map((r) => ({ id: r.dataset.stepId, num: r.querySelector(".tp-num").textContent,
          name: r.querySelector(".tp-name").textContent, meta: r.querySelector(".tp-meta").textContent, when: r.querySelector(".tp-when").textContent,
          now: r.classList.contains("now") && getComputedStyle(r.querySelector(".tp-now")).display !== "none", cur: r.getAttribute("aria-current") === "true",
          title: r.title, here: !!r.parentElement.querySelector(".tp-here"), tab: r.tabIndex })),
        hint: ((document.querySelector("#tp-steps .tp-hint") || {}).textContent || "").trim(),
        tools: [...document.querySelectorAll("#tp-steps .tp-tools button")].map((b) => b.textContent.trim()),
        tabs: [...document.querySelectorAll("#tp-tabs .anno-tab")].map((t) => t.getAttribute("aria-label")),
        focus: ((document.activeElement || {}).dataset || {}).stepId || (document.activeElement || {}).id || "",
      }));
      G.list = await list();
      // Paste notes... : two steps without a time.
      await page.locator("#tp-steps .tp-paste").click({ timeout: T });
      await page.waitForSelector(".modal-prompt .modal-input", { timeout: T });
      await page.fill(".modal-prompt .modal-input", "Check the stock: in the stock sheet\nSend the confirmation");
      await page.click(".modal-prompt .modal-ok");
      await page.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
      await page.waitForFunction(() => document.querySelectorAll("#tp-steps .tp-row").length === 5, null, { timeout: T });
      G.pasted = await list();
      const untimed = G.pasted.rows.filter((r) => r.here).map((r) => r.id);
      await pausedAt(26);
      await page.locator('#tp-steps .tp-item[data-step-id="' + untimed[0] + '"] .tp-here').click({ timeout: T });
      await page.waitForFunction((id) => !document.querySelector('#tp-steps .tp-item[data-step-id="' + id + '"] .tp-here'), untimed[0], { timeout: T });
      await wait(300);
      G.oneLeft = await list();
      await pausedAt(29);
      await page.locator('#tp-steps .tp-item[data-step-id="' + untimed[1] + '"] .tp-here').click({ timeout: T });
      await page.waitForFunction((id) => !document.querySelector('#tp-steps .tp-item[data-step-id="' + id + '"] .tp-here'), untimed[1], { timeout: T });
      await wait(300);
      G.timed = await list();
      // The keyboard: the list is one Tab stop; Down moves, Enter opens.
      await page.locator("#tp-steps .tp-row").first().focus();
      await page.keyboard.press("ArrowDown");
      G.down = (await list()).focus;
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => !!document.getElementById("tp-editor"), null, { timeout: T });
      const opened = () => page.evaluate(() => {
        const nav = (s) => document.querySelector("#tp-steps " + s);
        return { id: document.getElementById("tp-editor").dataset.stepId, pos: nav(".tp-pos").textContent,
          prev: nav(".tp-prev").getAttribute("aria-disabled"), next: nav(".tp-next").getAttribute("aria-disabled"),
          prevTitle: nav(".tp-prev").title, nextTitle: nav(".tp-next").title, steps: nav(".tp-open-steps").textContent, stepsTitle: nav(".tp-open-steps").title,
          verbs: [...document.querySelectorAll("#tp-steps .tp-verb")].filter((b) => !b.hidden).map((b) => b.textContent + (b.disabled ? " (off)" : "")),
          panel: document.getElementById("step-panel").hidden,
          video: document.getElementById("video").paused,
          tl: Math.round(document.getElementById("timeline-scroll").getBoundingClientRect().width) };
      });
      G.open2 = await opened();
      await page.locator("#tp-steps .tp-prev").click({ timeout: T });
      await page.waitForFunction((id) => document.getElementById("tp-editor").dataset.stepId !== id, G.open2.id, { timeout: T });
      G.first = await opened();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.getElementById("tp-editor"), null, { timeout: T });
      await wait(200);
      G.escaped = await list();
      // The last row: Next disabled; Open in Steps selects it in Steps.
      await page.locator("#tp-steps .tp-row").last().click({ timeout: T });
      await page.waitForFunction(() => !!document.getElementById("tp-editor"), null, { timeout: T });
      G.last = await opened();
      await page.locator("#tp-steps .tp-open-steps").click({ timeout: T });
      await page.waitForFunction(() => require("./state.js").getLevel() === "steps", null, { timeout: T });
      await wait(400);
      G.inSteps = await page.evaluate(() => ({ sel: require("./state.js").getSelectedStepId(), name: (document.getElementById("step-name") || {}).value }));
      await level("flow");
      // Notes: Add note at the clock's moment, then Edit and Delete.
      await page.locator("#tp-tab-notes").click({ timeout: T });
      G.notesEmpty = await page.evaluate(() => ({ text: document.getElementById("tp-notes").innerText.trim(),
        add: (document.querySelector("#tp-notes .tp-add-note") || {}).title }));
      await page.locator("#tp-notes .tp-add-note").click({ timeout: T });
      await prompt("Ask about orders by phone");
      await page.waitForSelector("#tp-notes .tp-note-row", { timeout: T });
      G.note = await page.evaluate(() => ({ row: document.querySelector("#tp-notes .tp-note-row").innerText.replace(/\s+/g, " ").trim(),
        tab: document.getElementById("tp-tab-notes").getAttribute("aria-label") }));
      await page.locator("#tp-notes .tp-note-delete").click({ timeout: T });
      await page.waitForFunction(() => !document.querySelector("#tp-notes .tp-note-row"), null, { timeout: T });
      G.noteGone = await page.evaluate(() => document.getElementById("tp-tab-notes").getAttribute("aria-label"));
      await page.keyboard.press("Control+z");
      await page.waitForSelector("#tp-notes .tp-note-row", { timeout: T });
      G.noteBack = true;
      await page.locator("#tp-tab-files").click({ timeout: T });
      G.files = await page.evaluate(() => ({ text: document.getElementById("tp-files").innerText.trim(),
        attach: (document.querySelector("#tp-files .tp-attach") || {}).title }));
      await page.locator("#tp-tab-steps").click({ timeout: T });
    } catch (x) { G.err = errText(x); }
    const L = G.list || { rows: [] };
    record("(G1) lane PANE item 2: the Steps tab lists the steps in the order of the process, each with its number, name, the line \"No system yet\" with what it lacks, and its start (the step being marked \"· open\"); the row at the clock's moment says now; Paste notes... above it; a row's tooltip says it opens the step",
      !G.err && L.rows.length === 3 && JSON.stringify(L.rows.map((r) => r.num)) === '["1","2","3"]' &&
        L.rows[0].name === "Take the call" && L.rows[0].meta === "No system yet" &&
        L.rows[1].meta === "No system yet · no name yet · no description yet" && /^\d:\d{2}$/.test(L.rows[0].when) && / · open$/.test(L.rows[2].when) &&
        L.rows.filter((r) => r.now).length <= 1 && L.rows.every((r) => r.title === "Opens this step.") &&
        JSON.stringify(L.tools) === '["Paste notes..."]' && L.tabs[0] === "Steps (3)",
      JSON.stringify(G.err ? G : L));
    const P2 = G.pasted || { rows: [] }, O1 = G.oneLeft || { rows: [] }, TT = G.timed || { rows: [] };
    record("(G2) lane PANE item 2: two steps pasted as notes are listed with \"no time yet\" and Starts here, under \"2 steps have no time yet. ...\"; at a moment, Starts here gives each its time (the hint then counts 1, then goes), the focus staying on its row",
      !G.err && P2.rows.length === 5 && P2.rows.filter((r) => r.here).length === 2 && P2.rows.filter((r) => r.when === "no time yet").length === 2 &&
        P2.hint === "2 steps have no time yet. Go to the moment a step starts in the video, then click Starts here on that step." &&
        O1.hint === "1 step has no time yet. Go to the moment a step starts in the video, then click Starts here on that step." &&
        TT.hint === "" && TT.rows.every((r) => !r.here && r.when !== "no time yet") && TT.focus === P2.rows.filter((r) => r.here)[1].id &&
        TT.tabs[0] === "Steps (5)",
      JSON.stringify(G.err ? G : { pasted: P2, oneLeft: O1.hint, timed: TT }));
    const o2 = G.open2 || {}, f1 = G.first || {}, la = G.last || {};
    record("(G3) lane PANE item 3: Down then Enter opens the second step in place (Step 2 of 5), the step panel closed and the video still paused; Previous opens the first (Previous disabled there), Next disabled on the last, each with its tooltip; Split..., Merge with next, Hide step under it; Escape goes back to the list, the focus on the row it was opened from (the second); Open in Steps selects the step in Steps",
      !G.err && G.down === (TT.rows[1] || {}).id && o2.id === G.down && o2.pos === "Step 2 of 5" && o2.prev === null && o2.next === null && o2.panel && o2.video &&
        f1.pos === "Step 1 of 5" && f1.prev === "true" && f1.prevTitle === "Opens the step before this one." && f1.nextTitle === "Opens the step after this one." &&
        la.pos === "Step 5 of 5" && la.next === "true" && la.steps === "Open in Steps" &&
        la.stepsTitle === "Opens this step in Steps." &&
        JSON.stringify(o2.verbs.slice(0, 3).map((v) => v.replace(" (off)", ""))) === '["Split…","Merge with next","Hide step"]' &&
        G.escaped.focus === o2.id && !!G.inSteps && G.inSteps.sel === la.id,
      JSON.stringify(G.err ? G : { open2: o2, first: f1, last: la, escaped: G.escaped && G.escaped.focus, inSteps: G.inSteps }));
    record("(G4) lane PANE item 4: Notes says No notes yet while there is none, Add note adds one at the clock's moment (its row: the moment, the text, At a moment, on no step; the tab counts it), Delete takes it out and Ctrl+Z brings it back; Files says No files attached yet, with Attach file...",
      !G.err && G.notesEmpty.text.endsWith("No notes yet.") &&
        G.notesEmpty.add === "Adds a note at this moment." &&
        /^\d:\d{2} Ask about orders by phone At a moment, on no step Edit Delete$/.test(G.note.row) && G.note.tab === "Notes (1)" &&
        G.noteGone === "Notes (0)" && G.noteBack &&
        G.files.text.endsWith("No files attached yet.") &&
        G.files.attach === "Copies a file into the project.",
      JSON.stringify(G.err ? G : { notesEmpty: G.notesEmpty, note: G.note, gone: G.noteGone, files: G.files }));
  }

  // ================= E. From a video to one zip: the Checklist fits the project =================
  // A project made from a video opens on the Timeline; its Checklist reads
  // Add the steps, Write the steps, Write the document, Hand off, each
  // button taking the analyst to the act; Confirm is asked nowhere; the
  // hand-off zip's root holds what a reader needs, its project folder
  // leaves out the backups and the log; the Checklist then names the version.
  {
    const EPROJ = path.join(TMP, "Call checklist");
    const EZIP = path.join(TMP, "Order to cash call v1.zip");
    const E = { selected: [] };
    const checklist = () => page.evaluate(() => {
      const line = document.getElementById("ov-next");
      const b = document.getElementById("btn-ov-next");
      return line ? { next: line.dataset.next, stages: [...line.querySelectorAll(".ov-next-stage")].map((li) => li.dataset.stage),
        labels: [...line.querySelectorAll(".ov-next-stage")].map((li) => li.textContent.replace("✓", "").trim()),
        done: [...line.querySelectorAll(".ov-next-stage.done")].map((li) => li.dataset.stage),
        button: b ? b.textContent.trim() : null, act: b ? b.dataset.nextAct : null,
        say: ((line.querySelector(".ov-next-say") || {}).textContent || "").trim(),
        ready: ((line.querySelector(".ov-next-ready-text") || {}).textContent || "").trim() } : null;
    });
    const getLevel = () => page.evaluate(() => require("./state.js").getLevel());
    const FULL = { title: "Order to cash call", purpose: "Hand the order call over to the team", scope: "From the call to the sales order",
      trigger: "A customer calls the order desk", result: "A sales order", contacts: "The order desk lead",
      business_rules: "Every order needs a customer number", exceptions: "A new customer is created first",
      effort: "About 20 calls a day, 4 minutes each", improvement: "Read the order from the call notes" };
    try {
      await stubOpen(VIDEO);
      await stubSave(EPROJ);
      await newProject("#btn-new-from-video");
      await opened(EPROJ);
      await settled();
      E.level = await getLevel();
      await level("overview");
      E.first = await checklist();
      await page.click("#btn-ov-next");
      await wait(400);
      E.afterFirst = await getLevel();
      // Two steps, at two moments of the video.
      for (const [k, f] of [[1, 0.25], [2, 0.6]]) {
        await rightClickItem(f, "Add a step here");
        await page.waitForFunction((n) => (require("./state.js").getSession().annotations.steps || []).length === n, k, { timeout: T });
      }
      await level("overview");
      E.added = await checklist();
      // Write the steps in Steps opens Steps on the first step without a name
      // of its own or a description: name and describe it, twice.
      for (const [name, desc] of [["Take the call", "Note who calls and what they order."], ["Enter the order", "Type the order into Order Desk."]]) {
        await level("overview");
        await page.click("#btn-ov-next");
        await page.waitForFunction(() => require("./state.js").getLevel() === "steps" && !!require("./state.js").getSelectedStepId(), null, { timeout: T });
        await wait(400);
        const sid = await page.evaluate(() => require("./state.js").getSelectedStepId());
        E.selected.push(sid);
        await page.fill("#step-name", name);
        await page.press("#step-name", "Enter");
        await page.locator("#step-desc").fill(desc);
        await page.locator("#step-desc").press("Tab");
        await page.waitForFunction(([s, n, d]) => {
          const st = (require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === s);
          return !!st && st.name === n && st.description === d;
        }, [sid, name, desc], { timeout: T });
        if (E.selected.length === 1) { await level("overview"); E.oneWritten = await checklist(); }
      }
      // C26 (lane D6): the information the steps use, typed in Steps: the
      // first step (done in SAP) gets two lines, the second (no system) one.
      // A line whose name is emptied goes and says so; Ctrl+Z brings it back,
      // and a second Ctrl+Z takes back the line's add.
      await level("steps");
      const I = (E.info = {});
      const infoOf = (sid) => page.evaluate((s) => {
        const st = (require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === s);
        return st && Array.isArray(st.information) ? st.information : [];
      }, sid);
      const lines = (sid, n) => page.waitForFunction(([s, k]) => {
        const st = (require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === s);
        return ((st && st.information) || []).length === k;
      }, [sid, n], { timeout: T });
      const addLine = async (sid, name, example, where) => {
        const n = (await infoOf(sid)).length;
        await page.click("#btn-info-add");
        await page.waitForSelector("#info-name-new", { timeout: T });
        if (I.focus === undefined) I.focus = await page.evaluate(() => (document.activeElement || {}).id || "");
        await page.keyboard.type(name);
        if (example || where) { await page.keyboard.press("Tab"); await page.keyboard.type(example || ""); }
        if (where) { await page.keyboard.press("Tab"); await page.keyboard.type(where); }
        await page.keyboard.press("Enter");
        await lines(sid, n + 1);
        await wait(300);
      };
      await selectStep(E.selected[0]);
      I.empty = await page.evaluate(() => {
        const sect = document.getElementById("step-info");
        const add = document.getElementById("btn-info-add");
        return sect ? { head: (document.getElementById("step-info-title") || {}).textContent, rows: sect.querySelectorAll(".info-row").length,
          add: add ? add.textContent : null, addTitle: add ? add.title : null,
          afterDesc: !!sect.compareDocumentPosition && !!(document.getElementById("step-desc").compareDocumentPosition(sect) & Node.DOCUMENT_POSITION_FOLLOWING) } : null;
      });
      await page.fill("#step-system", "SAP");
      await page.press("#step-system", "Enter");
      await page.waitForFunction((s) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === s) || {}).system === "SAP",
        E.selected[0], { timeout: T });
      await addLine(E.selected[0], "Customer number", "10482", "SAP, Sold-to party");
      await addLine(E.selected[0], "Order lines", "2", "");
      const fitInfo = () => page.evaluate(() => {
        // Every part of the section inside the pane, no two parts of a row
        // over each other, and a text cut only where it ends in an ellipsis.
        const sect = document.getElementById("step-info");
        const pane = document.getElementById("step-detail");
        const r = pane.getBoundingClientRect();
        const parts = [...sect.querySelectorAll(".info-row > *, #btn-info-add")].filter((el) => el.getBoundingClientRect().width > 0);
        const outside = parts.filter((el) => { const b = el.getBoundingClientRect(); return b.left < r.left - 1 || b.right > r.right + 1; }).length;
        let overlaps = 0;
        for (const row of sect.querySelectorAll(".info-row")) {
          const kids = [...row.children].map((k) => k.getBoundingClientRect()).filter((b) => b.width > 0);
          for (let i = 1; i < kids.length; i++) if (kids[i].left < kids[i - 1].right - 1 && kids[i].top < kids[i - 1].bottom - 1) overlaps++;
        }
        const cutButtons = [...sect.querySelectorAll("button")].filter((b) => b.scrollWidth > b.clientWidth + 1).length;
        const add = document.getElementById("btn-info-add").getBoundingClientRect();
        return { outside, overlaps, cutButtons, wide: pane.scrollWidth - pane.clientWidth, addHeight: Math.round(add.height),
          fieldWidth: Math.round((sect.querySelector(".info-input") || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width) };
      });
      I.editor = await page.evaluate(() => {
        const sect = document.getElementById("step-info");
        const label = (el) => (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => (document.getElementById(id) || {}).textContent || "").join(" ");
        return {
          cols: [...sect.querySelectorAll(".info-head .info-col")].map((c) => c.textContent),
          rows: [...sect.querySelectorAll(".info-row.info-typed")].map((row) => [...row.querySelectorAll("input")].map((i) => i.value)),
          labels: [...sect.querySelectorAll(".info-row.info-typed input")].slice(0, 3).map(label),
          remove: [...sect.querySelectorAll(".info-remove")].map((b) => [b.textContent, b.title]),
          focusAfter: (document.activeElement || {}).id || "",
        };
      });
      I.fit = await fitInfo();
      const shotDir = process.env.PDT_D6_SHOTS || "";
      const sz = await page.evaluate(() => window.innerWidth + "x" + window.innerHeight);
      const shotAs = async (tag) => {
        if (!shotDir) return;
        fs.mkdirSync(shotDir, { recursive: true });
        await page.evaluate(() => { document.getElementById("step-info").scrollIntoView({ block: "center" }); return true; });
        await wait(300);
        // The window as it shows (the app's zoom included), from Electron.
        const png = await app.evaluate(async ({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible()) || BrowserWindow.getAllWindows()[0];
          return (await w.webContents.capturePage()).toPNG().toString("base64");
        }).catch(() => null);
        if (png) fs.writeFileSync(path.join(shotDir, "d6-window-" + sz + tag + ".png"), Buffer.from(png, "base64"));
      };
      await shotAs("");
      // At 125% (app-zoom.js: Ctrl+Plus twice) the section still fits.
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); return true; });
      await page.keyboard.press("Control+=");
      await page.keyboard.press("Control+=");
      await wait(600);
      I.zoom = await page.evaluate(() => require("electron").webFrame.getZoomFactor()).catch(() => null);
      I.fit125 = await fitInfo();
      await shotAs("-125");
      await page.keyboard.press("Control+0");
      await wait(600);
      await selectStep(E.selected[1]);
      await addLine(E.selected[1], "Delivery date", "2026-11-20", "");
      // Escape puts back what a field held.
      await page.click("#info-example-0");
      await page.keyboard.press("End");
      await page.keyboard.type(" or later");
      await page.keyboard.press("Escape");
      I.escaped = await page.evaluate(() => document.getElementById("info-example-0").value);
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); return true; });
      await wait(300);
      I.afterEscape = (await infoOf(E.selected[1])).map((e) => e.example || "");
      await addLine(E.selected[1], "Temporary note", "", "");
      await page.fill("#info-name-1", "");
      await page.press("#info-name-1", "Enter");
      await lines(E.selected[1], 1);
      I.toast = await page.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim());
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); return true; });
      await wait(300);
      await page.keyboard.press("Control+z");
      await lines(E.selected[1], 2);
      I.back = (await infoOf(E.selected[1])).map((e) => e.name);
      await wait(300);
      await page.keyboard.press("Control+z");
      await lines(E.selected[1], 1);
      await wait(600);
      I.disk = (readJson(path.join(EPROJ, "annotations.json")).steps || []).filter((x) => Array.isArray(x.information))
        .map((x) => ({ id: x.step_id, state: x.state, info: x.information }));
      // The PDD, exported: section 5 names the lines under their systems,
      // each step its "Information:" line, and no example is printed.
      const pddFiles = await exportPdd("call-info");
      const pddDoc = docxText(pddFiles);
      I.pdd = { five: pddDoc.rows.filter((r) => /^(System|SAP|Not in a system) \| /.test(r)),
        lines: pddDoc.paras.filter((t) => t.startsWith("Information: ")),
        examples: ["10482", "Sold-to party", "2026-11-20"].filter((x) => pddDoc.paras.concat(pddDoc.rows).some((t) => t.includes(x))) };
      await level("overview");
      E.written = await checklist();
      for (const [key, value] of Object.entries(FULL)) await docField(key, value);
      await wait(400);
      E.ready = await checklist();
      // Steps: no Confirm transaction, no draft status, on the reference transaction.
      await level("steps");
      await wait(400);
      E.steps = await page.evaluate(() => ({ confirm: document.querySelectorAll('[data-act="confirm-run"]').length,
        draft: document.querySelectorAll(".run-status-draft").length,
        undo: document.querySelectorAll('[data-act="reopen-run"]').length }));
      // The hand-off from the Checklist's own button.
      await level("overview");
      await app.evaluate(({ shell }) => { global.__shownE = []; shell.showItemInFolder = (f) => { global.__shownE.push(f); }; });
      await page.click("#btn-ov-next");
      await page.waitForSelector(".modal-prompt .modal-input", { timeout: T });
      E.dialog = await page.evaluate(() => ((document.querySelector(".modal-prompt .modal-detail") || {}).textContent || "").trim());
      await page.click(".modal-prompt .modal-ok");
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && !fs.existsSync(EZIP)) await wait(500);
      await page.waitForFunction(() => !document.getElementById("btn-session-export-menu").classList.contains("busy"), null, { timeout: 180000 });
      await wait(600);
      const files = zipFiles(fs.readFileSync(EZIP));
      const names = Object.keys(files);
      E.root = names.filter((n) => !n.includes("/"));
      const top = path.basename(EPROJ) + "/";
      E.leftOut = names.filter((n) => n.startsWith(top) && (/^annotations\.json\.[2-5]$/.test(n.slice(top.length)) ||
        n.slice(top.length) === "normalize.log" || /\.pdt-staged$|\.zip\.building$/.test(n)));
      E.backups = fs.readdirSync(EPROJ).filter((n) => /^annotations\.json\.[2-5]$/.test(n));
      E.inFolder = names.includes(top + "annotations.json") && names.some((n) => n.startsWith(top + "video/") && !n.endsWith("/"));
      const entry = (readJson(path.join(EPROJ, "annotations.json")).handoffs || [])[0] || null;
      E.entry = entry;
      const tech = E.root.includes("Order to cash call v1 Technical details.xlsx");
      E.tech = tech;
      // C26: the lines typed on the steps make the Technical details of a
      // project without a recording; its Information sheet holds them.
      if (tech) {
        const sheet = xlsxRows(zipFiles(files["Order to cash call v1 Technical details.xlsx"]), "Information");
        E.sheets = sheet.names;
        E.infoSheet = sheet.rows;
      }
      if (files["Order to cash call v1 PDD.docx"]) {
        const d = docxText(zipFiles(files["Order to cash call v1 PDD.docx"]));
        E.zipPdd = { five: d.rows.filter((r) => /^(System|SAP|Not in a system) \| /.test(r)), lines: d.paras.filter((t) => t.startsWith("Information: ")) };
      }
      E.note = files["Start here.txt"] ? files["Start here.txt"].toString("utf8") : "";
      E.wantNote = entry ? require(path.join(VIEWER, "handoff.js")).startHereText({ base: "Order to cash call", version: 1, entry,
        folder: path.basename(EPROJ), has: { tech, mapSvg: true, mapBpmn: true } }) : null;
      E.wantRoot = ["Order to cash call v1 PDD.docx"].concat(tech ? ["Order to cash call v1 Technical details.xlsx"] : [],
        ["Order to cash call v1 map.svg", "Order to cash call v1 map.bpmn", "Start here.txt"]);
      E.shown = await app.evaluate(() => global.__shownE.slice());
      await level("overview");
      await page.waitForFunction(() => /^Version 1 was handed off on /.test(((document.querySelector("#ov-next .ov-next-ready-text") || {}).textContent || "")),
        null, { timeout: T }).catch(() => {});
      E.after = await checklist();
    } catch (x) { E.err = errText(x); }
    record("(E1) a project made from a video opens on the Timeline; its Checklist reads Add the steps, Write the steps, Write the document, Hand off, and its button marks the steps on the Timeline",
      !E.err && E.level === "flow" && !!E.first &&
      JSON.stringify(E.first.labels) === JSON.stringify(["Add the steps", "Write the steps", "Write the document", "Hand off"]) &&
      E.first.next === "steps" && E.first.button === "Mark the steps on the Timeline" && E.first.act === "steps-timeline" &&
      E.first.say === "Play the video and press S, or click Add step, where each step starts." && E.afterFirst === "flow",
      JSON.stringify({ err: E.err, level: E.level, first: E.first, afterFirst: E.afterFirst }));
    record("(E2) with steps added, Write the steps counts the steps without a name of their own or a description, and its button opens Steps on the first of them",
      !E.err && !!E.added && JSON.stringify(E.added.done) === '["steps"]' && E.added.next === "written" &&
      E.added.button === "Write the steps in Steps" && E.added.say === "2 of 2 steps have no name of their own or no description." &&
      !!E.oneWritten && E.oneWritten.say === "1 of 2 steps has no name of its own or no description." &&
      E.selected.length === 2 && E.selected[0] !== E.selected[1] && !!E.written && E.written.next === "document",
      JSON.stringify({ added: E.added, oneWritten: E.oneWritten, written: E.written, selected: E.selected }));
    record("(E3) named, described and the document written: the Checklist's one button is Hand off..., and Confirm is asked nowhere (no Confirm transaction, no draft status in Steps)",
      !E.err && !!E.ready && E.ready.ready === "Everything before the hand-off is done." && E.ready.button === "Hand off..." &&
      E.ready.act === "handoff" && E.ready.stages.length === 0 && !!E.steps && E.steps.confirm === 0 && E.steps.draft === 0 && E.steps.undo === 0,
      JSON.stringify({ ready: E.ready, steps: E.steps }));
    record("(E4) Hand off... from the Checklist: its line says what the zip holds (C26: with the Technical details, its steps listing information); the zip's root holds the PDD, the Technical details, the map as a picture and as BPMN and Start here.txt, the project folder leaving out the backups and the log",
      !E.err && E.dialog === "Order to cash call v1.zip is made next to the project folder: the whole project, with the PDD, the Technical details and the process map of version 1." &&
      E.tech === true &&
      JSON.stringify(E.root) === JSON.stringify(E.wantRoot) && E.note === E.wantNote && E.backups.length >= 1 && E.leftOut.length === 0 &&
      E.inFolder && E.shown.length === 1 && path.resolve(E.shown[0]) === path.resolve(EZIP),
      JSON.stringify({ dialog: E.dialog, root: E.root, backups: E.backups, leftOut: E.leftOut, note: E.note.slice(0, 200), shown: E.shown }));
    record("(E5) after the hand-off the Checklist names the version and its date, with Hand off... again",
      !E.err && !!E.after && !!E.entry &&
      E.after.ready === "Version 1 was handed off on " + E.entry.handed_off_at.slice(0, 10) + ". Hand off again after a change." &&
      E.after.button === "Hand off...", JSON.stringify(E.after));
    // C26 (lane D6): the information a step uses, in a project made from a video.
    const I = E.info || {};
    const W = { add: "Adds a line for something this step uses or enters.", remove: "Takes this line out. Ctrl+Z brings it back." };
    record("(E6) C26: Steps' editor has an Information section after the Description: with nothing yet, its heading and Add information (its tooltip) only; Add information opens a row with its name focused",
      !E.err && !!I.empty && I.empty.head === "Information" && I.empty.rows === 0 && I.empty.add === "Add information" &&
      I.empty.addTitle === W.add && I.empty.afterDesc && I.focus === "info-name-new",
      JSON.stringify({ empty: I.empty, focus: I.focus }));
    record("(E7) C26: two lines typed on the first step and one on the second, each saved on Enter: three fields under the column names Information, Example and Where it goes (each field labelled by its column), Remove on each (its tooltip), the focus back on Add information, nothing outside the pane",
      !E.err && !!I.editor && JSON.stringify(I.editor.cols) === JSON.stringify(["Information", "Example", "Where it goes", ""]) &&
      JSON.stringify(I.editor.rows) === JSON.stringify([["Customer number", "10482", "SAP, Sold-to party"], ["Order lines", "2", ""]]) &&
      JSON.stringify(I.editor.labels) === JSON.stringify(["Information", "Example", "Where it goes"]) &&
      I.editor.remove.length === 2 && I.editor.remove.every(([t, title]) => t === "Remove" && title === W.remove) &&
      I.editor.focusAfter === "btn-info-add",
      JSON.stringify(I.editor));
    const fits = (f) => !!f && f.outside === 0 && f.overlaps === 0 && f.cutButtons === 0 && f.wide <= 0 && f.addHeight >= 16 && f.fieldWidth >= 60;
    record("(E7b) C26: the Information section fits the editor's pane at this window and at 125% zoom: nothing outside the pane, no part of a row over another, no button cut",
      !E.err && fits(I.fit) && Math.abs((I.zoom || 0) - 1.25) < 0.01 && fits(I.fit125),
      JSON.stringify({ fit: I.fit, zoom: I.zoom, fit125: I.fit125 }));
    record("(E8) C26: Escape puts back what a field held; a line whose name is emptied goes, saying \"A line needs a name, so it was taken out. Ctrl+Z brings it back.\"; Ctrl+Z brings it back, and a second Ctrl+Z takes back its add",
      !E.err && I.escaped === "2026-11-20" && JSON.stringify(I.afterEscape) === '["2026-11-20"]' &&
      I.toast === "A line needs a name, so it was taken out. Ctrl+Z brings it back." &&
      JSON.stringify(I.back) === '["Delivery date","Temporary note"]' && Array.isArray(I.disk) &&
      JSON.stringify(I.disk.map((x) => x.info)) === JSON.stringify([
        [{ name: "Customer number", example: "10482", goes_to: "SAP, Sold-to party" }, { name: "Order lines", example: "2" }],
        [{ name: "Delivery date", example: "2026-11-20" }]]) && I.disk.every((x) => x.state === "manually_authored"),
      JSON.stringify({ escaped: I.escaped, afterEscape: I.afterEscape, toast: I.toast, back: I.back, disk: I.disk }));
    const five = ["System | Information entered", "SAP | Customer number, Order lines", "Not in a system | Delivery date"];
    const stepLines = ["Information: Customer number, Order lines.", "Information: Delivery date."];
    record("(E9) C26: the exported PDD names the information under its systems in section 5 and under each step (\"Information: ...\"), and prints no example; the hand-off's PDD says the same",
      !E.err && !!I.pdd && JSON.stringify(I.pdd.five) === JSON.stringify(five) && JSON.stringify(I.pdd.lines) === JSON.stringify(stepLines) &&
      I.pdd.examples.length === 0 && !!E.zipPdd && JSON.stringify(E.zipPdd.five) === JSON.stringify(five) &&
      JSON.stringify(E.zipPdd.lines) === JSON.stringify(stepLines),
      JSON.stringify({ pdd: I.pdd, zip: E.zipPdd }));
    record("(E10) C26: the hand-off's Technical details have an Information sheet of three rows (Step, Information, Example, Where it goes, From), the lines as typed",
      !E.err && Array.isArray(E.infoSheet) && JSON.stringify(E.infoSheet) === JSON.stringify([
        ["Step", "Information", "Example", "Where it goes", "From"],
        ["Step 1: Take the call", "Customer number", "10482", "SAP, Sold-to party", "Typed by the analyst"],
        ["Step 1: Take the call", "Order lines", "2", "", "Typed by the analyst"],
        ["Step 2: Enter the order", "Delivery date", "2026-11-20", "", "Typed by the analyst"]]),
      JSON.stringify({ sheets: E.sheets, rows: E.infoSheet }));
  }
  } // end of D.

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[companion-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[companion-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
