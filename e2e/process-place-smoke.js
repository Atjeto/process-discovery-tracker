"use strict";
/*
 * Process place e2e smoke (2.0.5, contract C22; the owner's report: while
 * listening to a video, the SME corrects a step in its second half, or adds
 * a condition to something shown in its first; a step marked there on the
 * Timeline came after every step in between). Launches the REAL viewer on a
 * throwaway profile, the main process's file dialogs replaced, on a project
 * made from a synthetic video in a temp folder, and drives the mouse and the
 * keys as a person does:
 *   (a) one transaction marked from 0:01 to 0:20 with three steps, one after
 *       another; then, after its end, the correction marked at 0:24: it is
 *       outside the transactions, and every step goes by its time;
 *   (b) Alt+Up on a step with a time moves it in the process and leaves its
 *       band where it is (it reads Placed, a toast says so); Alt+Down puts it
 *       back, placed no more;
 *   (c) the correction's band right-clicked, Place after a step..., the
 *       second step chosen in the list: it joins the transaction right after
 *       that step, its row reads Placed with its own time (0:24), its Flow
 *       line says where it was placed (with Back to its time), and its band
 *       stays where it was, marked, the legend saying what the mark is;
 *   (d) the map the PDD prints (the step BPMN, analyzed when the Map opens)
 *       runs through it where it was placed;
 *   (e) Alt+Down moves it one step on, still placed (its time is outside the
 *       transaction), Alt+Up back;
 *   (f) Merge with next on the step before it is refused (they are apart on
 *       the Timeline) and changes nothing;
 *   (g) the step it comes after hidden: it keeps its place after the step
 *       before that one; Ctrl+Z brings both back;
 *   (h) Back to its time, from its row's menu: it is outside the
 *       transactions again; Ctrl+Z places it again;
 *   (i) + Add step with the first step selected: the new step, without a
 *       time, comes right after it (not after every step with a time) and
 *       reads no Placed;
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
const VIDEO = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");   // companion-smoke's, made here when absent
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("process-place-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

/* The task names met walking the step BPMN from its start event (a map with
   one transaction is one chain). */
function bpmnChain(file) {
  const xml = fs.readFileSync(file, "utf-8");
  const names = new Map();
  for (const m of xml.matchAll(/<bpmn:(task|manualTask|userTask|subProcess|startEvent|endEvent|exclusiveGateway)\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[2]), name = /\bname="([^"]*)"/.exec(m[2]);
    if (id) names.set(id[1], { kind: m[1], name: name ? name[1] : "" });
  }
  const next = new Map();
  for (const m of xml.matchAll(/<bpmn:sequenceFlow\b([^>]*)>/g)) {
    const a = /\bsourceRef="([^"]+)"/.exec(m[1]), b = /\btargetRef="([^"]+)"/.exec(m[1]);
    if (a && b) next.set(a[1], b[1]);
  }
  const start = [...names].find(([, v]) => v.kind === "startEvent");
  const out = [];
  let at = start ? next.get(start[0]) : null;
  for (let k = 0; at && k < 50; k++) {
    const n = names.get(at);
    if (!n || n.kind === "endEvent") break;
    if (n.kind !== "exclusiveGateway") out.push(n.name);
    at = next.get(at);
  }
  return out;
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-place-"));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#btn-recent-menu", { timeout: T });
  } catch (e) { console.error("[process-place-e2e] FATAL:", e); process.exit(2); }
  const app = v.app;

  const anno = () => page.evaluate(() => require("./state.js").getSession().annotations);
  const stats = () => page.evaluate(() => require("./state.js").getSession().stats);
  const level = async (l) => { await page.locator('.view-mode-btn[data-level="' + l + '"]').click({ timeout: T }); await wait(300); };
  const stubOpen = (p) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, p);
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
    return { left: r.left, width: r.width, top: r.top, first: sp.startMs, span: sp.endMs - sp.startMs,
      lowY: band ? band.getBoundingClientRect().bottom + 14 : r.top + 34 };
  });
  const xOf = (g, ms) => g.left + ((ms - g.first) / g.span) * g.width;
  const rightClickItem = async (x, y, label) => {
    await page.mouse.click(x, y, { button: "right" });
    await page.locator("#tl-ctx-menu div", { hasText: label }).first().click({ timeout: T });
  };
  const runs = async () => ((await stats()).case_stats || []).filter((c) => !c.parent_case_id);
  const stepById = async (id) => (await anno()).steps.find((s) => s.step_id === id);
  // A project made from a video applies its marker changes itself: wait
  // until nothing waits or runs.
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
  const openTransaction = async () => {
    await level("steps");
    await page.evaluate(() => { const r = document.querySelector("#step-list .run-group:not(.run-group-outside) .run-row");
      if (r && !r.closest(".run-group").classList.contains("open")) r.click(); });
    await wait(400);
  };
  const openOutside = async () => {
    await level("steps");
    await page.evaluate(() => { const r = document.querySelector("#step-list .run-group-outside .run-row");
      if (r && !r.closest(".run-group").classList.contains("open")) r.click(); });
    await wait(400);
  };
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#step-list .run-group.open .step-row")].map((r) => ({
    id: r.dataset.stepId, name: (r.querySelector(".step-name") || {}).textContent, placed: !!r.querySelector(".step-placed"),
    placedTitle: (r.querySelector(".step-placed") || {}).title || "", time: ((r.querySelector(".step-time") || {}).textContent || "").trim() })));
  const selectRow = async (id) => {
    await page.locator('#step-list .step-row[data-step-id="' + id + '"] .step-name').click({ timeout: T });
    await wait(300);
  };
  // A band as drawn: whether it starts where its step's time is (within two
  // pixels), its mark and its tooltip.
  const bandOf = (id) => page.evaluate((sid) => {
    const el = document.querySelector('#timeline .tl-step-band[data-step-id="' + sid + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect(), host = document.getElementById("timeline").getBoundingClientRect();
    const sp = require("./views/flow-view-video.js").timelineSpan();
    const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
    const x = host.left + ((Date.parse(s.time_range.start) - sp.startMs) / (sp.endMs - sp.startMs)) * host.width;
    return { atItsTime: Math.abs(r.left - x) <= 2, start: s.time_range.start, placed: el.classList.contains("placed"), title: el.title };
  }, id);
  const settled = () => page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
    null, { timeout: 180000 });

  // The synthetic video (32 s), made once (the timeline smoke's recipe).
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

  const PROJ = path.join(TMP, "Order call");
  let origin = NaN;
  const at = (sec) => origin + sec * 1000;
  const atClick = (sec) => at(sec + 0.4);   // a click lands within a pixel: the clock reads `sec`
  const ids = [];
  let correction = null, run1 = null;

  // (a) One transaction, three steps, then the correction after its end.
  let a = {};
  try {
    await stubOpen(VIDEO);
    await stubSave(PROJ);
    await page.click("#btn-new-menu");
    await page.click("#btn-new-from-video");
    await page.waitForFunction((f) => { const s = require("./state.js").getSession();
      return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase() && !!s.stats && !document.getElementById("run-status"); },
    path.resolve(PROJ), { timeout: 120000 });
    origin = Date.parse(readJson(path.join(PROJ, "manifest.json")).started_at);
    await level("flow");
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 30000 });
    let g = await geo();
    await rightClickItem(xOf(g, atClick(1)), g.lowY, "Start a transaction here");
    await prompt("Order 1");
    await apply();
    for (const sec of [3, 8, 13]) {
      g = await geo();
      await rightClickItem(xOf(g, atClick(sec)), g.lowY, "Add a step here");
      await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k, ids.length + 1, { timeout: T });
      ids.push((await anno()).steps.find((s) => !ids.includes(s.step_id)).step_id);
    }
    g = await geo();
    await rightClickItem(xOf(g, atClick(20)), g.lowY, "End the transaction here");
    await apply();
    g = await geo();
    await rightClickItem(xOf(g, atClick(24)), g.lowY, "Add a step here");
    await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k, 4, { timeout: T });
    correction = (await anno()).steps.find((s) => !ids.includes(s.step_id)).step_id;
    run1 = (await runs())[0].case_id;
    const c = await stepById(correction);
    a.outside = c.case_id == null;
    a.correctionAt = Math.abs(Date.parse(c.time_range.start) - atClick(24)) < 400;
    await openTransaction();
    a.rows = (await rows()).map((r) => r.name + "@" + r.time + (r.placed ? "*" : ""));
  } catch (e) { a.err = errText(e); }
  record("(a) a transaction from 0:01 to 0:20 with three steps marked one after another, and the correction marked at 0:24, after its end: the correction is outside the transactions and the steps go by their time",
    !a.err && a.outside && a.correctionAt && JSON.stringify(a.rows) === '["Step 1@0:03","Step 2@0:08","Step 3@0:13"]', JSON.stringify(a));

  // (b) Alt+Up on a step with a time: a move in the process; Alt+Down back.
  let b = {};
  try {
    await level("flow");
    b.bandBefore = await bandOf(ids[2]);
    await openTransaction();
    await selectRow(ids[2]);
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForFunction((sid) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after; }, ids[2], { timeout: T });
    b.toast = await toastText();
    b.rows = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
    b.after = (await stepById(ids[2])).placed_after === ids[0];
    await level("flow");
    b.bandAfter = await bandOf(ids[2]);
    await openTransaction();
    await selectRow(ids[2]);
    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForFunction((sid) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after == null; }, ids[2], { timeout: T });
    b.back = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
  } catch (e) { b.err = errText(e); }
  record("(b) Alt+Up on a step with a time moves it in the process, its band staying where it is on the Timeline (its row reads Placed and a toast says it stays at 0:13); Alt+Down puts it back, placed no more",
    !b.err && b.after && JSON.stringify(b.rows) === '["Step 1","Step 3*","Step 2"]' && /stays at 0:13/.test(b.toast) &&
      b.bandBefore && b.bandAfter && b.bandBefore.start === b.bandAfter.start && b.bandAfter.atItsTime && b.bandAfter.placed &&
      JSON.stringify(b.back) === '["Step 1","Step 2","Step 3"]',
    JSON.stringify(b));

  // (c) The correction's band right-clicked: Place after a step..., the
  // second step chosen.
  let c = {};
  try {
    await level("flow");
    c.bandBefore = await bandOf(correction);
    c.startBefore = (await stepById(correction)).time_range.start;
    const box = await page.locator('#timeline .tl-step-band[data-step-id="' + correction + '"]').boundingBox({ timeout: T });
    await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: "right" });
    c.menu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu > div")].map((d) => (d.textContent || "").trim()));
    await page.locator("#tl-ctx-menu div", { hasText: "Place after a step" }).click({ timeout: T });
    await page.waitForSelector(".modal-choose .modal-list", { timeout: T });
    c.dialog = await page.evaluate(() => ({ title: document.querySelector(".modal-choose h2").textContent,
      msg: document.querySelector(".modal-choose .modal-msg").textContent,
      groups: [...document.querySelectorAll(".modal-choose optgroup")].map((g) => g.label),
      options: [...document.querySelectorAll(".modal-choose option")].map((o) => o.textContent.trim()) }));
    await page.selectOption(".modal-choose .modal-list", "after:" + ids[1]);
    await page.click(".modal-choose .modal-ok");
    await page.waitForSelector(".modal-choose", { state: "detached", timeout: T });
    await page.waitForFunction((sid) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after; }, correction, { timeout: T });
    const s = await stepById(correction);
    c.saved = s.placed_after === ids[1] && s.case_id === run1 && s.time_range.start === c.startBefore;
    c.toast = await toastText();
    await level("flow");
    c.bandAfter = await bandOf(correction);
    c.legend = await page.evaluate(() => { const el = document.querySelector("#timeline-legend .lg-placed"); return el ? el.style.display !== "none" : false; });
    await openTransaction();
    c.rows = (await rows()).map((r) => r.name + "@" + r.time + (r.placed ? "*" : ""));
    c.title = ((await rows()).find((r) => r.id === correction) || {}).placedTitle;
    // The step's own pane: its Flow line says where it was placed.
    await selectRow(correction);
    c.flow = await page.evaluate(() => ({ line: ((document.getElementById("step-placed-line") || {}).textContent || "").replace(/\s+/g, " ").trim(),
      back: !!document.getElementById("btn-flow-back-to-time"), place: !!document.getElementById("btn-flow-place") }));
  } catch (e) { c.err = errText(e); }
  record("(c) the correction's band, right-clicked: Place after a step..., the second step chosen in the list of the transaction's steps: it joins the transaction right after it, reads Placed with its own time (0:24), its band stays where it was, marked, and the legend says what the mark is",
    !c.err && c.menu.includes("Place after a step…") && c.dialog.title === "Place after a step" &&
      /stays at 0:24/.test(c.dialog.msg) && c.dialog.groups.length === 1 && /^Transaction 1/.test(c.dialog.groups[0]) &&
      c.dialog.options[0] === "First in Transaction 1" && c.dialog.options.length === 4 && c.saved && /after "Step 2"/.test(c.toast) &&
      c.bandBefore && c.bandAfter && c.bandBefore.start === c.bandAfter.start && c.bandAfter.atItsTime && c.bandAfter.placed &&
      /In the process: after "Step 2"/.test(c.bandAfter.title) && c.legend &&
      JSON.stringify(c.rows) === '["Step 1@0:03","Step 2@0:08","Step 4@0:24*","Step 3@0:13"]' && /after "Step 2"/.test(c.title || "") &&
      /^Placed You placed this step in the process after "Step 2"\. On the timeline it stays at 0:24, where it was shown\. Back to its time$/.test(c.flow.line) &&
      c.flow.back && c.flow.place,
    JSON.stringify(c));

  // (d) The map the PDD prints runs through it where it was placed.
  let d = {};
  try {
    await level("map");
    await settled();
    await wait(800);
    await settled();
    d.chain = bpmnChain(path.join(PROJ, "process_map_step.bpmn"));
  } catch (e) { d.err = errText(e); }
  record("(d) the map the PDD prints (the step BPMN, analyzed as the Map opens) runs Step 1, Step 2, then the correction, then Step 3",
    !d.err && JSON.stringify(d.chain) === '["Step 1","Step 2","Step 4","Step 3"]', JSON.stringify(d));

  // (e) Alt+Down and Alt+Up on it: still placed (its time is outside the
  // transaction).
  let e = {};
  try {
    await openTransaction();
    await selectRow(correction);
    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForFunction(([sid, a]) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after === a; }, [correction, ids[2]], { timeout: T });
    e.down = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
    await selectRow(correction);
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForFunction(([sid, a]) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after === a; }, [correction, ids[1]], { timeout: T });
    e.up = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
  } catch (err) { e.err = errText(err); }
  record("(e) Alt+Down moves it after Step 3, still placed (its time is outside the transaction), and Alt+Up back after Step 2",
    !e.err && JSON.stringify(e.down) === '["Step 1","Step 2","Step 3","Step 4*"]' && JSON.stringify(e.up) === '["Step 1","Step 2","Step 4*","Step 3"]',
    JSON.stringify(e));

  // (f) Merge with next on the step before it is refused.
  let f = {};
  try {
    const before = JSON.stringify((await anno()).steps);
    await selectRow(ids[1]);
    await page.locator("#btn-step-merge").click({ timeout: T });
    await wait(500);
    f.toast = await toastText();
    f.same = JSON.stringify((await anno()).steps) === before;
  } catch (err) { f.err = errText(err); }
  record("(f) Merge with next on Step 2 (the next row is the correction) is refused: they are apart on the Timeline; nothing changes",
    !f.err && /apart on the Timeline/.test(f.toast) && f.same, JSON.stringify(f));

  // (g) The step it comes after hidden: it keeps its place.
  let gT = {};
  try {
    await selectRow(ids[1]);
    await page.locator("#btn-step-hide").click({ timeout: T });
    await page.waitForFunction((sid) => require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid).state === "hidden", ids[1], { timeout: T });
    gT.rows = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
    gT.after = (await stepById(correction)).placed_after === ids[0];
    await page.keyboard.press("Control+z");
    await page.waitForFunction((sid) => require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid).state !== "hidden", ids[1], { timeout: T });
    await wait(300);
    gT.back = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
  } catch (err) { gT.err = errText(err); }
  record("(g) Step 2 hidden: the correction keeps its place, now after Step 1; Ctrl+Z brings Step 2 back with the correction after it",
    !gT.err && gT.after && JSON.stringify(gT.rows) === '["Step 1","Step 4*","Step 3"]' && JSON.stringify(gT.back) === '["Step 1","Step 2","Step 4*","Step 3"]',
    JSON.stringify(gT));

  // (h) Back to its time, from its row's menu; Ctrl+Z places it again.
  let h = {};
  try {
    const row = page.locator('#step-list .step-row[data-step-id="' + correction + '"]');
    await row.click({ button: "right", timeout: T });
    h.menu = await page.evaluate(() => [...document.querySelectorAll("#step-ctx-menu > div")].map((x) => (x.textContent || "").trim()).filter(Boolean));
    await page.locator("#step-ctx-menu div", { hasText: "Back to its time" }).click({ timeout: T });
    await page.waitForFunction((sid) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after == null && s.case_id == null; }, correction, { timeout: T });
    h.toast = await toastText();
    await openTransaction();
    h.rows = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
    await page.keyboard.press("Control+z");
    await page.waitForFunction(([sid, a]) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.placed_after === a; }, [correction, ids[1]], { timeout: T });
    await wait(300);
    await openTransaction();
    h.again = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
  } catch (err) { h.err = errText(err); }
  record("(h) Back to its time, from its row's menu (with Move up, Move down and Place after a step...): it is outside the transactions again, the toast saying where its time puts it; Ctrl+Z places it again",
    !h.err && h.menu.includes("Move up") && h.menu.includes("Move down") && h.menu.includes("Place after a step…") &&
      /Back where its time puts it, at 0:24/.test(h.toast) && JSON.stringify(h.rows) === '["Step 1","Step 2","Step 3"]' &&
      JSON.stringify(h.again) === '["Step 1","Step 2","Step 4*","Step 3"]',
    JSON.stringify(h));

  // (i) + Add step after the first step: right after it.
  let i = {};
  try {
    await selectRow(ids[0]);
    await page.locator("#btn-add-manual-step").click({ timeout: T });
    await prompt("Get approval");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).some((s) => s.name === "Get approval"), null, { timeout: T });
    await wait(300);
    i.rows = (await rows()).map((r) => r.name + (r.placed ? "*" : ""));
  } catch (err) { i.err = errText(err); }
  record("(i) + Add step with Step 1 selected: the new step, without a time, comes right after Step 1, not after every step with a time, and reads no Placed",
    !i.err && JSON.stringify(i.rows) === '["Step 1","Get approval","Step 2","Step 4*","Step 3"]', JSON.stringify(i));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[process-place-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[process-place-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
