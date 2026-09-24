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
    const ok = !err && st.attach === "Attach" && st.lineState === "No transcript" && st.removeHidden && st.laneRowHidden &&
      st.label === null && st.laneName === null && st.blocks.length === 0 && st.said === null && st.overview === null &&
      !(await page.$("#btn-session-more-menu, #session-more-popup"));
    record("(a) before an import the only transcript UI is Attach on the Overview's project line (No transcript)", ok, JSON.stringify({ err, st }));
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
      st.attach === "Replace" && st.lineState === "Transcript" && !st.removeHidden && !st.laneRowHidden;
    record("(b) Attach transcript writes transcript.json (10 sentences, not synced) and the copied original; the project line offers Replace and Remove",
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
      JSON.stringify(flow.laneActs) === JSON.stringify(["Sync...", "Replace...", "Remove"]) &&
      flow.blocks.length === 0 && step && step.note === NOT_SYNCED && step.rows.length === 0 && step.buttons.length === 0 &&
      ov && ov.count === "(10)" && ov.rows.length === 10 && ov.note === NOT_SYNCED && !ov.during && ov.inDocUnderSummary &&
      ov.what === "Everything that was said";
    record("(c) not synced: the lane, named Transcript at the left, says Not synced with Sync..., Replace... and Remove, the step editor shows one line, the Overview lists all 10 (\"Everything that was said\") with the line and no transactions filter, in the document under the project line",
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
    let err = null, listed = null, desc = null, after = null, empty = null, hint = null, panelSaid = null;
    try {
      await openStep(SAVE.step_id);
      listed = (await surfaces()).said;
      // The step panel beside the list shows the same sentences in the
      // step's row, under a Said: lead (the owner's review).
      panelSaid = await page.evaluate((id) => {
        const r = document.querySelector('#step-panel:not([hidden]) #sp-body .sp-occ[data-step-id="' + id + '"]');
        return r ? { leads: [...r.querySelectorAll(".sp-lead")].map((l) => (l.textContent || "").trim()),
          lines: [...r.querySelectorAll(".sp-said .tr-text")].map((e) => e.textContent) } : null;
      }, SAVE.step_id);
      // Item 1: the drafting's narration is the description's hint, not its text.
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
    } catch (e) { err = errText(e); }
    const saved = ((readJson(ANNO).steps || []).find((s) => s.step_id === SAVE.step_id) || {});
    // The draft's narration is only the hint, so the description holds the sentence alone.
    const appended = typeof desc === "string" && desc === S.t0005;
    const hintOk = !!hint && hint.value === "" && hint.placeholder === String(SAVE.description || "").trim() && hint.placeholder.length > 0;
    const button = (list, seg) => ((list && list.buttons) || []).find((b) => b.seg === seg) || {};
    const resident = await page.evaluate(() => {
      const more = document.querySelector("#step-detail .step-detail-more");
      const said = document.getElementById("step-said");
      return { moreClosed: !!(more && !more.open), saidOutsideMore: !!(said && !(more && more.contains(said))),
        descOutsideMore: !!(document.getElementById("step-desc") && !(more && more.contains(document.getElementById("step-desc")))) };
    }).catch((e) => ({ err: e.message }));
    const ok = !err && resident.moreClosed && resident.saidOutsideMore && resident.descOutsideMore &&
      !!listed && JSON.stringify(listed.rows) === JSON.stringify([S.t0004, S.t0005]) &&
      listed.buttons.every((b) => b.text === "Add" && !b.disabled) && appended && hintOk &&
      typeof saved.description === "string" && saved.description === S.t0005 && saved.state === "edited" &&
      button(after, "t0005").text === "Added" && button(after, "t0004").text === "Add" &&
      !!empty && empty.note === "Nothing was said during this step." && empty.rows.length === 0 &&
      !!panelSaid && JSON.stringify(panelSaid.leads) === '["Said:"]' && JSON.stringify(panelSaid.lines) === JSON.stringify([S.t0004, S.t0005]);
    record("(e) the step editor lists the sentences of the step's window (10 s lead) under the resident Description (More stays closed; the draft's narration is its hint, not its text), Add fills it and saves it (no Save button), the button reads Added; a quiet step says so; the step panel's row shows them under a Said: lead",
      ok, JSON.stringify({ err, resident, listed, panelSaid, hint, desc: desc && desc.slice(-80), saved: saved.description && saved.description.slice(-80), after: after && after.buttons, empty }));
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
      JSON.stringify(menu.map((m) => m.key)) === JSON.stringify(["purpose", "scope", "trigger", "result", "business_rules", "exceptions", "improvement", "notes"]) &&
      br && br.disabled && br.text === "Business rules (added)" && menu.filter((m) => m.disabled).length === 1;
    record("(f) the Overview lists the talk outside the transactions (7); the speaker filter, the search and the transactions checkbox narrow and widen it; Add to offers every field but the title and contacts (trigger, result and improvement included) and Business rules saves document.business_rules",
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
      st.attach === "Attach" && st.lineState === "No transcript" && st.removeHidden && st.laneRowHidden && st.label === null && st.laneName === null &&
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
    const uok = !uerr && undo && undo.json && undo.copy && undo.attach === "Replace" && undo.lineState === "Transcript" && !undo.removeHidden &&
      redo && !redo.json && !redo.copy && redo.attach === "Attach" && redo.lineState === "No transcript";
    record("(h) lane CC: Ctrl+Z brings the transcript and its original file back (the project line says Transcript again), Ctrl+Y takes them out again",
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
    const ok = !err && toast.error && /^The transcript could not be read: it is not valid JSON \(.+\)\. Replace it on the Overview, on the line under the Checklist\.$/.test(toast.text) &&
      st.attach === "Replace" && st.lineState === "Transcript cannot be read" && !st.removeHidden && st.laneRowHidden && st.label === null &&
      st.laneName === null && st.said === null && st.overview === null && again === false &&
      !fs.existsSync(TRANSCRIPT) && after.attach === "Attach" && after.removeHidden;
    record("(j) a transcript.json that cannot be read is said once on load, shows nowhere else, and Remove transcript clears it",
      ok, JSON.stringify({ err, toast, again, st, after: after && [after.attach, after.removeHidden] }));
    if (!ok) await shot(page, "fail-transcript-unreadable.png");
  }

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-transcript-page-errors.png");

  await viewer.close();
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
