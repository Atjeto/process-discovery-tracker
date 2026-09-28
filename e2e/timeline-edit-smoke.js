"use strict";
/*
 * Timeline edit e2e smoke (2.0.3, a process manager's report: a step added
 * on a video's Timeline, then a transaction started a few pixels after it,
 * left the step outside the transaction, and nothing could be dragged,
 * synced or retimed). Launches the REAL viewer on a throwaway profile, the
 * main process's file dialogs replaced, on a project made from a synthetic
 * video in a temp folder, and drives the mouse and the keys as a person does.
 * On the Timeline:
 *   (a) the report's clicks: Add a step here, then Start a transaction here
 *       6 px after the step's start: the transaction starts at the step's
 *       start (it snaps), drawn at once where it was put, pending (no bar
 *       under it); Apply marker changes asks nothing in a project with no
 *       drafts, and the step is in the transaction;
 *   (b) a step's start dragged out of the transaction: the step leaves it at
 *       once (Outside the transactions), its time the one dropped, the time
 *       shown while dragging; Ctrl+Z puts it back, Ctrl+Y again;
 *   (c) the transaction's start dragged to the step's (it snaps): the band
 *       stands there, pending, one change to apply however often it is
 *       dragged; applied, the step is in the transaction again;
 *   (d) Esc during a drag puts the side back and saves nothing;
 *   (e) two steps back to back: dragging the side they share moves both,
 *       one undoable edit;
 *   (f) the System field: its list arrow lies in the field's right padding,
 *       and Enter saves the system and leaves the field, which then shows it
 *       set.
 * Times typed in Steps:
 *   (g) the selected step's start and end are fields on its line of facts:
 *       a start typed moves it (it leaves the transaction when typed before
 *       it, Ctrl+Z brings it back), Up adds a second and Escape puts the
 *       field back, a text that is no time and a start after the end are
 *       refused, each saying why;
 *   (h) an open transaction's Starts at typed: the field dashed, "Not
 *       applied yet" and Apply marker changes beside it, which applies it
 *       (no question in a project without drafts): the transaction starts
 *       there;
 *   (i) its Ends at (greyed while it runs to the end) typed adds its End,
 *       applied there; emptied, the End goes and it runs to the end again;
 *   (j) a step added with + Add step has no time: "no time yet: starts at",
 *       a start typed gives it one (until the next step) and a band on the
 *       Timeline.
 *   Zero page errors. Exits 0 when every check passed, 1 on a failed check,
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
const errText = (e) => { logActionError("timeline-edit-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-tledit-"));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#btn-recent-menu", { timeout: T });
  } catch (e) { console.error("[timeline-edit-e2e] FATAL:", e); process.exit(2); }
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
  // The timeline's geometry: x on screen of a moment, and the moment of an x.
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
    await page.locator("#tl-ctx-menu div", { hasText: label }).click({ timeout: T });
  };
  // A band's side, pressed and dragged to x (in steps, as a hand does).
  const drag = async (sel, side, toX, opts) => {
    const r = await page.locator(sel).first().boundingBox({ timeout: T });
    const y = r.y + r.height / 2;
    const x0 = side === "start" ? r.x + 2 : r.x + r.width - 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 + (toX > x0 ? 4 : -4), y, { steps: 2 });
    await page.mouse.move(toX, y, { steps: 10 });
    const during = await page.evaluate(() => {
      const tip = document.querySelector("#timeline .tl-drag-time");
      return { tip: tip ? tip.textContent : null, dragging: document.body.classList.contains("tl-edge-dragging") };
    });
    if (opts && opts.escape) await page.keyboard.press("Escape");
    await page.mouse.up();
    await wait(400);
    return during;
  };
  const runs = async () => ((await stats()).case_stats || []).filter((c) => !c.parent_case_id);
  const stepById = async (id) => (await anno()).steps.find((s) => s.step_id === id);
  const apply = async () => {
    await page.locator("#btn-apply-marker-edits").click({ timeout: T });
    await wait(400);
    const asked = await page.$(".modal-confirm");
    if (asked) await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
    await page.waitForFunction(() => !document.getElementById("btn-apply-marker-edits") && !document.getElementById("run-status") &&
      !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
    await wait(500);
    return !!asked;
  };
  const stepsGroups = async () => {
    await level("steps");
    await wait(300);
    const out = await page.evaluate(() => [...document.querySelectorAll("#step-list .run-group")].map((g) =>
      ((g.querySelector(".run-title") || {}).textContent || "").trim() + ": " + ((g.querySelector(".run-meta") || {}).textContent || "").trim()));
    await level("flow");
    return out;
  };

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

  const PROJ = path.join(TMP, "Order call");
  let a = {};
  let stepId = null;
  try {
    await stubOpen(VIDEO);
    await stubSave(PROJ);
    await page.click("#btn-new-menu");
    await page.click("#btn-new-from-video");
    await page.waitForFunction((f) => { const s = require("./state.js").getSession(); return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase(); },
      path.resolve(PROJ), { timeout: 60000 });
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.stats && s.analysis) && !document.getElementById("run-status"); },
      null, { timeout: 120000 });
    await level("flow");
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 30000 });
    let g = await geo();
    // (a) The report's clicks.
    const x = g.left + 0.3 * g.width;
    await rightClickItem(x, g.lowY, "Add a step here");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 1, null, { timeout: T });
    const step = (await anno()).steps[0];
    stepId = step.step_id;
    await rightClickItem(x + 6, g.lowY, "Start a transaction here");
    await prompt("Order 1");
    await page.waitForSelector("#timeline .tl-case-band.pending", { timeout: T });
    g = await geo();
    const ins = (await anno()).marker_edits.find((e) => e.op === "insert");
    a.snapped = ins && ins.timestamp === step.time_range.start;
    a.pending = await page.evaluate(() => {
      const b = document.querySelector("#timeline .tl-case-band.pending");
      const r = b.getBoundingClientRect();
      return { left: r.left, bars: document.querySelectorAll("#timeline .tl-marker-pending").length,
        cta: ((document.getElementById("btn-apply-marker-edits") || {}).textContent || "").trim(), title: b.title };
    });
    a.bandAtStep = Math.abs(a.pending.left - xOf(g, Date.parse(step.time_range.start))) <= 1.5;
    a.asked = await apply();
    const rs = await runs();
    a.runs = rs.map((r) => ({ label: r.label, start: r.start_ts }));
    a.inRun = (await stepById(stepId)).case_id === (rs[0] && rs[0].case_id);
    a.groups = await stepsGroups();
    a.applied = await page.evaluate(() => ({ pending: document.querySelectorAll("#timeline .tl-case-band.pending").length,
      bands: document.querySelectorAll("#timeline .tl-case-band").length }));
  } catch (e) { a.err = errText(e); }
  record("(a) the report's clicks: Start a transaction here 6 px after a step's start starts it at the step's start (it snaps); the transaction is drawn at once where it was put, pending, with no bar under it and Apply 1 marker change; applying asks nothing (no drafts) and the step is in the transaction",
    !a.err && a.snapped && a.bandAtStep && a.pending.bars === 0 && a.pending.cta === "Apply 1 marker change" &&
      /Not applied yet: Apply marker changes/.test(a.pending.title) && /Drag its start to move it\./.test(a.pending.title) &&
      a.asked === false && a.runs.length === 1 && a.runs[0].label === "Order 1" && a.inRun &&
      JSON.stringify(a.groups) === '["Transaction 1: 1 step"]' && a.applied.pending === 0 && a.applied.bands === 1,
    JSON.stringify(a));

  // (b) The step's start dragged out of the transaction, then back by Ctrl+Z.
  let b = {};
  try {
    const before = await stepById(stepId);
    const g = await geo();
    const to = xOf(g, Date.parse(before.time_range.start)) - 60;
    b.during = await drag('#timeline .tl-step-band[data-step-id="' + stepId + '"]', "start", to);
    await page.waitForFunction((sid) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && !s.case_id;
    }, stepId, { timeout: T });
    const after = await stepById(stepId);
    b.movedS = (Date.parse(after.time_range.start) - Date.parse(before.time_range.start)) / 1000;
    b.endKept = after.time_range.end === before.time_range.end;
    b.state = after.state;
    b.groups = await stepsGroups();
    await page.keyboard.press("Control+z");
    await page.waitForFunction(([sid, st]) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.time_range.start === st && !!s.case_id;
    }, [stepId, before.time_range.start], { timeout: T });
    b.undone = true;
    await page.keyboard.press("Control+y");
    await page.waitForFunction((sid) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && !s.case_id;
    }, stepId, { timeout: T });
    b.redone = true;
  } catch (e) { b.err = errText(e); }
  record("(b) a step's start dragged out of its transaction: the step leaves it at once (Outside the transactions), its start the one dropped, its end kept, its time shown while dragging; Ctrl+Z puts it back, Ctrl+Y again",
    !b.err && b.during.dragging && /^0:\d\d$/.test(b.during.tip || "") && b.movedS < -1 && b.endKept && b.state === "manually_authored" &&
      JSON.stringify(b.groups) === '["Transaction 1: 0 steps","Outside the transactions: 1 step"]' && b.undone && b.redone,
    JSON.stringify(b));

  // (c) The transaction's start dragged to the step's start: it snaps.
  let c = {};
  try {
    const st = await stepById(stepId);
    let g = await geo();
    const target = xOf(g, Date.parse(st.time_range.start));
    // Twice: first well past it, then to 4 px from the step's start.
    await drag("#timeline .tl-case-band", "start", target - 30);
    await page.waitForSelector("#timeline .tl-case-band.pending", { timeout: T });
    await drag("#timeline .tl-case-band", "start", target + 4);
    await wait(300);
    g = await geo();
    c.band = await page.evaluate(() => {
      const el = document.querySelector("#timeline .tl-case-band");
      return { pending: el.classList.contains("pending"), left: el.getBoundingClientRect().left,
        cta: ((document.getElementById("btn-apply-marker-edits") || {}).textContent || "").trim() };
    });
    c.bandAtStep = Math.abs(c.band.left - xOf(g, Date.parse(st.time_range.start))) <= 1.5;
    c.asked = await apply();
    const rs = await runs();
    c.runStart = rs[0] && rs[0].start_ts;
    c.snapped = !!c.runStart && Date.parse(c.runStart) === Date.parse(st.time_range.start);
    c.inRun = (await stepById(stepId)).case_id === (rs[0] && rs[0].case_id);
    c.groups = await stepsGroups();
  } catch (e) { c.err = errText(e); }
  record("(c) the transaction's start dragged twice, the second time to 4 px from the step's start: it snaps there, the band stands there pending, one change to apply; applied, the transaction starts at the step and holds it",
    !c.err && c.band.pending && c.bandAtStep && c.band.cta === "Apply 1 marker change" && c.asked === false && c.snapped && c.inRun &&
      JSON.stringify(c.groups) === '["Transaction 1: 1 step"]',
    JSON.stringify(c));

  // (d) Esc during a drag puts the side back and saves nothing.
  let d = {};
  try {
    const before = JSON.stringify(await anno());
    const r0 = await page.locator("#timeline .tl-case-band").first().boundingBox();
    d.during = await drag("#timeline .tl-case-band", "start", r0.x + 80, { escape: true });
    const r1 = await page.locator("#timeline .tl-case-band").first().boundingBox();
    d.same = JSON.stringify(await anno()) === before;
    d.back = Math.abs(r1.x - r0.x) <= 1;
    d.cta = await page.$("#btn-apply-marker-edits");
  } catch (e) { d.err = errText(e); }
  record("(d) Esc during a drag puts the transaction's side back and saves nothing",
    !d.err && d.during.dragging && d.same && d.back && !d.cta, JSON.stringify({ same: d.same, back: d.back, err: d.err }));

  // (e) Two steps back to back: the side they share moves both.
  let e5 = {};
  try {
    let g = await geo();
    await rightClickItem(g.left + 0.7 * g.width, g.lowY, "Add a step here");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 2, null, { timeout: T });
    const two = (await anno()).steps.slice().sort((p, q) => Date.parse(p.time_range.start) - Date.parse(q.time_range.start));
    e5.touching = two[0].time_range.end === two[1].time_range.start;
    g = await geo();
    const shared = Date.parse(two[0].time_range.end);
    await drag('#timeline .tl-step-band[data-step-id="' + two[0].step_id + '"]', "end", xOf(g, shared) - 90);
    await page.waitForFunction(([id, end]) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === id);
      return s && s.time_range.end !== end;
    }, [two[0].step_id, two[0].time_range.end], { timeout: T });
    const s1 = await stepById(two[0].step_id), s2 = await stepById(two[1].step_id);
    e5.rolled = s1.time_range.end === s2.time_range.start && Date.parse(s1.time_range.end) < shared;
    e5.secondEndKept = s2.time_range.end === two[1].time_range.end;
    await page.keyboard.press("Control+z");
    await page.waitForFunction(([id, end]) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === id);
      return s && s.time_range.end === end;
    }, [two[0].step_id, two[0].time_range.end], { timeout: T });
    e5.bothBack = (await stepById(two[1].step_id)).time_range.start === two[1].time_range.start;
  } catch (e) { e5.err = errText(e); }
  record("(e) two steps back to back (Add a step here inside a step): dragging the side they share moves both, and one Ctrl+Z puts both back",
    !e5.err && e5.touching && e5.rolled && e5.secondEndKept && e5.bothBack, JSON.stringify(e5));

  // (f) The System field: the arrow in its padding; Enter saves and leaves it.
  let f = {};
  try {
    await level("steps");
    await page.evaluate(() => { const b = document.querySelector("#step-list .run-group:not(.open) .run-row"); if (b && !document.querySelector("#step-list .run-group.open .step-row")) b.click(); });
    await wait(300);
    await page.locator('#step-list .step-row[data-step-id="' + stepId + '"] .step-name').click({ timeout: T });
    await page.waitForSelector("#step-system", { timeout: T });
    await page.click("#step-system");
    // The arrow is a browser part no style reading reaches (getComputedStyle
    // gives the field's own): the rule that places it is read from the sheet.
    f.arrow = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules = [];
        try { rules = [...sheet.cssRules]; } catch (_) { continue; }
        const r = rules.find((x) => x.selectorText && /step-system-inline::-webkit-calendar-picker-indicator/.test(x.selectorText));
        if (r) return r.style.position + " right " + r.style.right;
      }
      return null;
    });
    await page.keyboard.type("Order Desk");
    await page.keyboard.press("Enter");
    await page.waitForFunction((sid) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.system === "Order Desk";
    }, stepId, { timeout: T });
    await wait(300);
    f.after = await page.evaluate(() => { const i = document.getElementById("step-system");
      return { value: i.value, focused: document.activeElement === i }; });
  } catch (e) { f.err = errText(e); }
  record("(f) the System field's list arrow lies in its right padding (no text under it); Enter saves the system and leaves the field, which shows it set",
    !f.err && f.arrow === "absolute right 4px" && f.after.value === "Order Desk" && f.after.focused === false, JSON.stringify(f));

  // ================= Times typed in Steps =================
  const typeIn = async (loc, text) => {
    await loc.click({ timeout: T });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await wait(500);
  };
  const toastText = () => page.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim());
  const origin = Date.parse(readJson(path.join(PROJ, "manifest.json")).started_at);
  const clockOf = (iso) => { const t = Math.round((Date.parse(iso) - origin) / 100); const s = Math.floor(t / 10);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + (t % 10 ? "." + (t % 10) : ""); };
  // The moment a typed "m:ss" or "m:ss.t" names (a time is typed to a tenth).
  const typedIso = (text) => { const [m, s] = text.split(":"); return new Date(origin + Math.round((Number(m) * 60 + Number(s)) * 1000)).toISOString(); };
  const openTransaction = async () => {
    await level("steps");
    await page.evaluate(() => { const r = document.querySelector("#step-list .run-group:not(.run-group-outside) .run-row");
      if (r && !r.closest(".run-group").classList.contains("open")) r.click(); });
    await wait(400);
  };
  const selectStep = async (id) => {
    await page.evaluate((sid) => { if (!document.querySelector('#step-list .step-row[data-step-id="' + sid + '"]')) {
      const g = document.querySelector("#step-list .run-group-outside:not(.open) .run-row"); if (g) g.click(); } }, id);
    await wait(300);
    await page.locator('#step-list .step-row[data-step-id="' + id + '"] .step-name').click({ timeout: T });
    await page.waitForSelector("#step-start", { timeout: T });
  };

  // (g) The step's own fields.
  let gT = {};
  try {
    await openTransaction();
    await selectStep(stepId);
    const s0 = await stepById(stepId);
    gT.shown = await page.evaluate(() => ({ start: document.getElementById("step-start").value, end: document.getElementById("step-end").value,
      label: document.getElementById("step-start").getAttribute("aria-label") }));
    gT.shownOk = gT.shown.start === clockOf(s0.time_range.start) && gT.shown.end === clockOf(s0.time_range.end);
    // Up adds a second; Escape puts the field back and saves nothing.
    await page.click("#step-start");
    await page.keyboard.press("ArrowUp");
    gT.up = await page.evaluate(() => document.getElementById("step-start").value);
    await page.keyboard.press("Escape");
    await wait(300);
    gT.escaped = (await stepById(stepId)).time_range.start === s0.time_range.start &&
      await page.evaluate(() => document.getElementById("step-start").value) === gT.shown.start;
    // A start 1 s later: the step moves, in its transaction.
    const laterText = clockOf(new Date(Date.parse(s0.time_range.start) + 1000).toISOString());
    const later = typedIso(laterText);
    await typeIn(page.locator("#step-start"), laterText);
    await page.waitForFunction(([sid, st]) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.time_range.start === st;
    }, [stepId, later], { timeout: T });
    gT.movedIn = !!(await stepById(stepId)).case_id;
    gT.left = await page.evaluate(() => !document.activeElement || document.activeElement.id !== "step-start");
    // Before the transaction: the step leaves it; Ctrl+Z brings it back.
    await typeIn(page.locator("#step-start"), "0:01");
    await page.waitForFunction((sid) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && !s.case_id;
    }, stepId, { timeout: T });
    gT.outside = true;
    await page.keyboard.press("Control+z");
    await page.waitForFunction(([sid, st]) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.time_range.start === st && !!s.case_id;
    }, [stepId, later], { timeout: T });
    gT.undone = true;
    // Refused, each saying why: no time, and a start after the end.
    await selectStep(stepId);
    await typeIn(page.locator("#step-start"), "5 seconds");
    gT.notATime = await toastText();
    const s1 = await stepById(stepId);
    await typeIn(page.locator("#step-start"), clockOf(new Date(Date.parse(s1.time_range.end) + 2000).toISOString()));
    gT.afterEnd = await toastText();
    gT.unchanged = (await stepById(stepId)).time_range.start === s1.time_range.start;
  } catch (e) { gT.err = errText(e); }
  record("(g) the selected step's start and end are fields on its line of facts: a start typed moves it (before its transaction it leaves it, Ctrl+Z brings it back), Up adds a second and Escape puts it back, a text that is no time and a start after the end are refused, saying why",
    !gT.err && gT.shownOk && gT.shown.label === "Start of this step" && gT.up !== gT.shown.start && gT.escaped &&
      gT.movedIn && gT.left && gT.outside && gT.undone &&
      /^That is not a time: type it the way the timeline shows it/.test(gT.notATime) &&
      /^The start of this step can be from .+ to .+: a step does not run over the steps beside it[.]$/.test(gT.afterEnd) && gT.unchanged,
    JSON.stringify(gT));

  // (h) The transaction's Starts at, typed, then applied from beside it.
  let hT = {};
  const txField = (side) => page.locator('#step-list .run-group.open .run-times [data-side="' + side + '"]');
  try {
    await openTransaction();
    const run0 = (await runs())[0];
    const earlierText = clockOf(new Date(Date.parse(run0.start_ts) - 1000).toISOString());
    const earlier = typedIso(earlierText);
    await typeIn(txField("start"), earlierText);
    await page.waitForSelector('#step-list .run-group.open .run-times [data-side="start"].pending', { timeout: T });
    hT.pending = await page.evaluate(() => {
      const t = document.querySelector("#step-list .run-group.open .run-times");
      return { note: ((t.querySelector(".run-times-note") || {}).textContent || "").trim(),
        apply: ((t.querySelector(".run-times-apply") || {}).textContent || "").trim() };
    });
    hT.asked = await (async () => {
      await page.locator("#step-list .run-group.open .run-times-apply").click({ timeout: T });
      await wait(400);
      const asked = !!(await page.$(".modal-confirm"));
      if (asked) await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await page.waitForFunction(() => !document.getElementById("btn-apply-marker-edits") && !document.getElementById("run-status") &&
        !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
      await wait(500);
      return asked;
    })();
    hT.start = (await runs())[0].start_ts;
    hT.startOk = Date.parse(hT.start) === Date.parse(earlier);
  } catch (e) { hT.err = errText(e); }
  record("(h) an open transaction's Starts at typed: the field dashed, Not applied yet and Apply 1 marker change beside it, which applies it with no question (no drafts): the transaction starts there",
    !hT.err && hT.pending.note === "Not applied yet" && hT.pending.apply === "Apply 1 marker change" && hT.asked === false && hT.startOk,
    JSON.stringify(hT));

  // (i) Its Ends at: typed adds its End; emptied takes it out.
  let iT = {};
  try {
    await openTransaction();
    iT.before = await page.evaluate(() => { const f = document.querySelector('#step-list .run-group.open .run-times [data-side="end"]');
      return { value: f.value, placeholder: f.placeholder }; });
    const run0 = (await runs())[0];
    const atText = clockOf(new Date(Date.parse(run0.start_ts) + 20000).toISOString());
    const at = typedIso(atText);
    await typeIn(txField("end"), atText);
    await page.waitForSelector('#step-list .run-group.open .run-times [data-side="end"].pending', { timeout: T });
    await page.locator("#step-list .run-group.open .run-times-apply").click({ timeout: T });
    await page.waitForFunction(() => !document.getElementById("btn-apply-marker-edits") && !document.getElementById("run-status") &&
      !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
    await wait(500);
    iT.end = (await runs())[0].end_ts;
    iT.endOk = !!iT.end && Date.parse(iT.end) === Date.parse(at);
    await openTransaction();
    await typeIn(txField("end"), "");
    await page.waitForSelector("#step-list .run-group.open .run-times-apply", { timeout: T });
    await page.locator("#step-list .run-group.open .run-times-apply").click({ timeout: T });
    await page.waitForFunction(() => !document.getElementById("btn-apply-marker-edits") && !document.getElementById("run-status") &&
      !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
    await wait(500);
    iT.endAfter = (await runs())[0].end_ts;
  } catch (e) { iT.err = errText(e); }
  record("(i) its Ends at, greyed while it runs to the end, typed adds its End (applied there); emptied, the End goes and it runs to the end again",
    !iT.err && iT.before.value === "" && /^0:\d\d/.test(iT.before.placeholder) && iT.endOk && iT.endAfter == null,
    JSON.stringify(iT));

  // (j) A step added without a time is given one.
  let jT = {};
  try {
    await openTransaction();
    const n0 = (await anno()).steps.length;
    await page.locator("#btn-add-manual-step").click({ timeout: T });
    await prompt("Call the customer");
    await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k + 1, n0, { timeout: T });
    const added = (await anno()).steps.find((s) => s.name === "Call the customer");
    await selectStep(added.step_id);
    jT.line = await page.evaluate(() => ((document.querySelector("#step-facts .step-facts-rest") || {}).textContent || "").replace(/\s+/g, " ").trim());
    jT.empty = await page.evaluate(() => document.getElementById("step-start").value === "" && !document.getElementById("step-end"));
    await typeIn(page.locator("#step-start"), "0:01");
    await page.waitForFunction((sid) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.time_range && s.time_range.start;
    }, added.step_id, { timeout: T });
    const placed = await stepById(added.step_id);
    const next = (await anno()).steps.filter((s) => s.step_id !== added.step_id && s.time_range && s.time_range.start)
      .map((s) => Date.parse(s.time_range.start)).filter((x) => x > origin + 1000).sort((a, b) => a - b)[0];
    jT.span = [clockOf(placed.time_range.start), Date.parse(placed.time_range.end) === next];
    await level("flow");
    jT.band = await page.evaluate((sid) => !!document.querySelector('#timeline .tl-step-band[data-step-id="' + sid + '"]'), added.step_id);
  } catch (e) { jT.err = errText(e); }
  record("(j) a step added with + Add step has no time: its line says \"no time yet: starts at\", a start typed gives it one, until the next step starts, and a band on the Timeline",
    !jT.err && /no time yet: starts at$/.test(jT.line) && jT.empty && jT.span[0] === "0:01" && jT.span[1] === true && jT.band,
    JSON.stringify(jT));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[timeline-edit-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[timeline-edit-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
