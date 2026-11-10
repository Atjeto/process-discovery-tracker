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
 *       under it); in a project made from a video it applies itself a moment
 *       later, with no click and no question, and the step is in the
 *       transaction;
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
 *   (h) an open transaction's Starts at typed: the field dashed, "Updates
 *       in a moment" and no Apply button beside it; it applies itself, and
 *       the transaction starts there;
 *   (i) its Ends at ("open" while it runs to the end) typed adds its End,
 *       applied there; emptied, the End goes and it runs to the end again;
 *   (j) a step added with + Add step has no time: "no time yet", its start
 *       and end fields (the end waiting for the start); a start typed gives
 *       it one (until the next step) and a band on the Timeline.
 * The owner's next report ("the duration is endless"), on a second new
 * project from the video:
 *   (k) its one unmarked transaction shows Starts at and Ends at ("open")
 *       before any marker; a start typed marks it, applied by itself;
 * and the owner's answer to that ("you always add steps sequentially"):
 *   (l) steps added one after another on the Timeline, each right-clicked
 *       on the band of the one before it, which runs on to the end until
 *       then: each ends the one before it, only the newest is open (fading
 *       out, "open" in Steps, no length); End the transaction here,
 *       right-clicked on the transaction's own band, ends the last step;
 *   (m) the transaction's start typed later takes its first step's start
 *       along, and its end typed later its last step's end;
 *   (n) the last step deleted gives its time back to the step before it; a
 *       step's end typed earlier and then emptied runs on again.
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

/* ---- Lane E: a messy call (E4 Not part of the process, E5 "<step>" starts here)
   A project made from the synthetic video with three steps written first
   (no time: "Open the order", "Check the stock", "Send the invoice"), opened
   in a viewer of its own:
     (o) E4: a Shift-drag across 0:08 to 0:16 does not start the video, its
         card shows the Duration only and offers "Not part of the process"
         (no "Leave out of the analysis"); one click marks it with no
         question and no analysis: excluded_ranges holds it, the Timeline
         draws it hatched with its label and tooltip, the legend says "not
         part of the process", and Steps says nothing of it;
     (p) playing from 0:06 skips it (no moment inside it is shown), and a
         seek into it plays it from there;
     (q) Include again, from the band's menu, takes it out; Ctrl+Z puts it
         back and Ctrl+Y takes it out again, none of them analyzing;
     (r) E5: "<step>" starts here names the first step without a time, on one
         line beside + Step; at 0:02, 0:24 and 0:16 it gives each step its
         moment in two acts (seek, click), the next one selected and named
         each time: their order in Steps stays as written, each is a band,
         each took the video's frame; then the button hides; Ctrl+Z gives the
         last one back its no time and takes its frame; the right-click menu
         offers the same act under Add a step here. */
async function laneE(TMP) {
  const T0 = Date.parse("2026-11-10T09:00:00.000Z");
  const dir = path.join(TMP, "Messy call");
  fs.mkdirSync(path.join(dir, "video"), { recursive: true });
  fs.copyFileSync(VIDEO, path.join(dir, "video", "call.webm"));
  const started = new Date(T0).toISOString();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: "lane-e-tl", source: "video", started_at: started, label: "Messy call" }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const hand = (id, name, order) => ({ step_id: id, name, state: "manually_authored", case_id: null, time_range: null, order,
    description: "", evidence: { interaction_event_ids: [], screenshot_refs: [] }, flags: { waste: false } });
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify({ version: 1, session_id: "lane-e-tl",
    steps: [hand("n1", "Open the order", 1), hand("n2", "Check the stock", 2), hand("n3", "Send the invoice", 3)],
    external_videos: [{ id: "v1", path: "video/call.webm", offset_ms: 0, in_ms: 0, out_ms: null, attached_at: started }] }, null, 2));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + dir], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.stats) && !require("./views/flow-view.js").analysisBusy(); }, null, { timeout: 60000 });
    await page.click('.view-mode-btn[data-level="flow"]');
    await page.waitForFunction(() => !!require("./views/flow-view-video.js").timelineSpan(), null, { timeout: T });
  } catch (e) {
    record("lane E: the project made from a video with three steps written first opens", false, errText(e));
    if (v) await v.close();
    return;
  }
  const anno = () => page.evaluate(() => require("./state.js").getSession().annotations);
  const at = () => page.evaluate(() => require("./views/flow-view-video.js").playheadMs());
  const seek = async (s) => { await page.evaluate((t) => require("./views/flow-view-video.js").seekClock(t, false), T0 + s * 1000); await wait(500); };
  const sec = (ms) => Math.round((ms - T0) / 100) / 10;
  // Measured again before each use: the step panel narrows the Timeline.
  const geom = () => page.evaluate(() => {
    const tl = document.getElementById("timeline");
    const r = tl.getBoundingClientRect();
    const sp = require("./views/flow-view-video.js").timelineSpan();
    return { left: r.left, width: r.width, top: r.top, bottom: r.bottom, first: sp.startMs, span: sp.endMs - sp.startMs };
  });
  const bgY = (g, x) => page.evaluate(({ x, top, bottom }) => {
    for (let y = top + 4; y < bottom; y += 2) if (document.elementFromPoint(x, y) === document.getElementById("timeline")) return y;
    return null;
  }, { x, top: g.top, bottom: g.bottom });
  const busy = () => page.evaluate(() => ({ busy: require("./views/flow-view.js").analysisBusy(), status: !!document.getElementById("run-status") }));

  // (o) E4: the act.
  const o = {};
  try {
    const g = await geom();
    const x = (s) => g.left + ((T0 + s * 1000 - g.first) / g.span) * g.width;
    const y = await bgY(g, x(8));
    // G: selecting a stretch never starts the video (a plain click seeks
    // and plays, as before).
    await page.evaluate(() => document.getElementById("video").pause());
    await wait(300);
    o.pausedBefore = await page.evaluate(() => document.getElementById("video").paused);
    await page.keyboard.down("Shift");
    await page.mouse.move(x(8), y);
    await page.mouse.down();
    await page.mouse.move(x(12), y, { steps: 5 });
    await page.mouse.move(x(16), y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await wait(600);
    o.pausedAfter = await page.evaluate(() => document.getElementById("video").paused);
    o.card = await page.evaluate(() => [...document.querySelectorAll("#tl-selection-stats .summary-fix")].map((b) => b.textContent));
    o.rows = await page.evaluate(() => [...document.querySelectorAll("#tl-selection-stats .row > span:first-child")].map((s) => s.textContent));
    o.tip = await page.evaluate(() => document.getElementById("tl-selection-exclude").title);
    await page.click("#tl-selection-exclude");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.excluded_ranges || []).length === 1, null, { timeout: T });
    o.dialog = await page.evaluate(() => !!document.querySelector(".modal-confirm"));
    o.toast = await page.evaluate(() => document.getElementById("toast").textContent);
    await wait(500);
    o.busy = await busy();
    const r = (await anno()).excluded_ranges[0];
    o.range = [sec(Date.parse(r.start)), sec(Date.parse(r.end))];
    o.drawn = await page.evaluate(() => {
      const b = document.querySelector("#timeline .tl-left-out");
      const lg = document.querySelector("#timeline-legend .lg-left-out");
      return { title: b && b.title, label: (document.querySelector(".tl-left-out-label") || {}).textContent,
        legend: lg && lg.textContent, legendTip: lg && lg.title, legendShown: !!lg && lg.checkVisibility() };
    });
    await page.click('.view-mode-btn[data-level="steps"]');
    await wait(400);
    o.steps = await page.evaluate(() => ({ notes: document.querySelectorAll('.run-notes li[data-kind="left_out"]').length,
      text: /left out of the analysis|not part of the process/i.test(document.getElementById("session-layout-steps").innerText) }));
    await page.click('.view-mode-btn[data-level="flow"]');
    await wait(400);
  } catch (e) { o.err = errText(e); }
  record("(o) lane E, E4: in a project made from a video a Shift-drag (which does not start the video) shows the stretch's Duration only and offers Not part of the process (not Leave out of the analysis); one click marks it with no question and no analysis (\"Marked as not part of the process.\"), hatched with its label and tooltip, the legend in its words, and Steps says nothing of it",
    !o.err && o.pausedBefore && o.pausedAfter && JSON.stringify(o.rows) === '["Duration"]' &&
      JSON.stringify(o.card) === '["Insert transaction from selection","Not part of the process"]' && !o.dialog &&
      o.tip === "Marks the selected stretch as not part of the process. It is skipped when playing and left out of the Transcript tab. Include again brings it back." &&
      /Marked as not part of the process\./.test(o.toast || "") &&
      !o.busy.busy && !o.busy.status && Math.abs(o.range[0] - 8) <= 0.3 && Math.abs(o.range[1] - 16) <= 0.3 &&
      /^Not part of the process: 0:0\d to 0:1\d\. Click it to include it again\.$/.test(o.drawn.title || "") && o.drawn.label === "Not part of the process" &&
      o.drawn.legend === "not part of the process" &&
      o.drawn.legendTip === "A stretch you marked as not part of the process. It is skipped when playing and left out of the Transcript tab." &&
      o.drawn.legendShown && o.steps.notes === 0 && !o.steps.text,
    JSON.stringify(o));

  // (p) the skip when playing.
  const p = {};
  try {
    const r = (await anno()).excluded_ranges[0];
    const a = Date.parse(r.start), b = Date.parse(r.end);
    await seek(6);
    await page.evaluate(() => document.getElementById("video").play());
    p.seen = [];
    const until = Date.now() + 5000;
    while (Date.now() < until) { p.seen.push(await at()); await wait(80); }
    await page.evaluate(() => document.getElementById("video").pause());
    p.inside = p.seen.filter((t) => t > a + 400 && t < b - 100).map(sec);
    p.after = p.seen.some((t) => t >= b);
    await seek(11);
    await page.evaluate(() => document.getElementById("video").play());
    await wait(1500);
    p.fromInside = sec(await at());
    await page.evaluate(() => document.getElementById("video").pause());
  } catch (e) { p.err = errText(e); }
  record("(p) lane E, E4: playing runs into the stretch and goes on at its end (no moment inside it shows); a seek into it plays it from there",
    !p.err && p.inside.length === 0 && p.after && p.fromInside > 11.5 && p.fromInside < 14, JSON.stringify({ err: p.err, inside: p.inside, after: p.after, fromInside: p.fromInside }));

  // (q) Include again, Ctrl+Z, Ctrl+Y.
  const q = {};
  try {
    await page.locator("#timeline .tl-left-out").click({ timeout: T });
    await page.locator("#tl-ctx-menu div", { hasText: "Include again" }).click({ timeout: T });
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.excluded_ranges || []).length === 0, null, { timeout: T });
    await wait(300);
    q.included = { busy: await busy(), bands: await page.evaluate(() => document.querySelectorAll("#timeline .tl-left-out").length),
      toast: await page.evaluate(() => document.getElementById("toast").textContent) };
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.excluded_ranges || []).length === 1 &&
      document.querySelectorAll("#timeline .tl-left-out").length === 1, null, { timeout: T });
    await wait(300);
    q.undone = await busy();
    await page.keyboard.press("Control+y");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.excluded_ranges || []).length === 0, null, { timeout: T });
    await wait(300);
    q.redone = await busy();
  } catch (e) { q.err = errText(e); }
  const calm = (b) => b && !b.busy && !b.status;
  record("(q) lane E, E4: Include again, from the stretch's menu, takes it out (\"Included again.\"); Ctrl+Z puts it back and Ctrl+Y takes it out again, none of them running an analysis",
    !q.err && calm(q.included.busy) && q.included.bands === 0 && /Included again\./.test(q.included.toast || "") &&
      calm(q.undone) && calm(q.redone), JSON.stringify(q));

  // (r) E5.
  const r5 = {};
  try {
    const button = () => page.evaluate(() => {
      const b = document.getElementById("btn-show-here"), plus = document.getElementById("btn-add-step");
      const rb = b.getBoundingClientRect(), rp = plus.getBoundingClientRect();
      const name = b.querySelector(".show-here-name");
      return { hidden: b.hidden, text: b.textContent, title: b.title, id: b.dataset.stepId, oneLine: !b.hidden && Math.abs(rb.top - rp.top) < 2 && rb.height < 40,
        fits: !b.hidden && name.getBoundingClientRect().right <= rb.right };
    });
    r5.first = await button();
    r5.acts = [];
    for (const [s, id] of [[2, "n1"], [24, "n2"], [16, "n3"]]) {
      await seek(s);
      const before = await button();
      await page.click("#btn-show-here");
      await page.waitForFunction((sid) => { const st = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid); return !!(st && st.time_range); }, id, { timeout: T });
      await wait(400);
      r5.acts.push({ named: before.id, at: s, next: (await button()).id || null });
      if (id === "n1") r5.toast = await page.evaluate(() => document.getElementById("toast").textContent);
    }
    const a = await anno();
    r5.times = a.steps.map((s) => s.step_id + "@" + (s.time_range ? sec(Date.parse(s.time_range.start)) : "-"));
    r5.frames = ["n1", "n2", "n3"].map((id) => (a.analyst_screenshots || []).some((x) => x.step_id === id && x.source === "video_frame"));
    r5.bands = await page.evaluate(() => [...document.querySelectorAll("#timeline .tl-step-band")].map((b) => b.dataset.stepId).sort().join(","));
    r5.hiddenAfter = (await button()).hidden;
    await page.click('.view-mode-btn[data-level="steps"]');
    await wait(400);
    r5.rows = await page.evaluate(() => [...document.querySelectorAll("#step-list .step-row[data-step-id]")].map((x) => x.dataset.stepId).join(","));
    await page.click('.view-mode-btn[data-level="flow"]');
    await wait(400);
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => !require("./state.js").getSession().annotations.steps.find((x) => x.step_id === "n3").time_range, null, { timeout: T });
    await wait(400);
    const u = await anno();
    r5.undo = { frame: (u.analyst_screenshots || []).some((x) => x.step_id === "n3"), button: (await button()).id };
    const g = await geom();
    const xr = g.left + ((T0 + 29000 - g.first) / g.span) * g.width;
    await page.mouse.click(xr, await bgY(g, xr), { button: "right" });
    r5.menu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu div")].map((d) => d.textContent));
    await page.keyboard.press("Escape");
  } catch (e) { r5.err = errText(e); }
  const menuAt = r5.menu ? r5.menu.indexOf("Add a step here") : -1;
  record("(r) lane E, E5: \"Open the order\" starts here, on one line beside + Step, gives the three steps written first their moments in two acts each (\"Open the order\" starts at 0:02.), naming the next each time; their order in Steps stays as written, each is a band with the video's frame; then it hides; Ctrl+Z gives the last its no time back and takes its frame; the right-click menu offers \"Send the invoice\" starts here under Add a step here",
    !r5.err && r5.first.text === '"Open the order" starts here' && r5.first.oneLine && r5.first.fits &&
      r5.first.title === 'Sets the start of "Open the order" to the moment the video shows now. Its place among the steps stays.' &&
      /"Open the order" starts at 0:02\./.test(r5.toast || "") &&
      JSON.stringify(r5.acts) === JSON.stringify([{ named: "n1", at: 2, next: "n2" }, { named: "n2", at: 24, next: "n3" }, { named: "n3", at: 16, next: null }]) &&
      r5.frames.every(Boolean) && r5.bands === "n1,n2,n3" && r5.hiddenAfter && r5.rows === "n1,n2,n3" &&
      !r5.undo.frame && r5.undo.button === "n3" && menuAt >= 0 && r5.menu[menuAt + 1] === '"Send the invoice" starts here',
    JSON.stringify(r5));

  record("lane E: zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
}

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
  // 2.0.3: a project made from a video applies its marker changes itself, a
  // moment after the change: nothing is clicked; this waits until nothing
  // waits or runs, and says whether anything asked a question meanwhile.
  const apply = async () => {
    let asked = false;
    const deadline = Date.now() + 120000;
    for (;;) {
      const st = await page.evaluate(() => {
        const s = require("./state.js").getSession(), ME = require("./marker-edits.js");
        return { asked: !!document.querySelector(".modal-confirm"),
          done: ME.pendingEditCount(s.annotations.marker_edits, ME.lastAnalysisMs(s)) === 0 &&
            !document.getElementById("run-status") && !require("./views/flow-view.js").analysisBusy() };
      });
      asked = asked || st.asked;
      if (st.done || st.asked || Date.now() > deadline) break;
      await wait(250);
    }
    await wait(500);
    return asked;
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
    // Lane E-1: the step just added opens in the step panel beside the
    // Timeline, which is then narrower: 6 px after the step's start is
    // measured again.
    await page.waitForSelector("#step-panel:not([hidden])", { timeout: T });
    await wait(300);
    g = await geo();
    await rightClickItem(xOf(g, Date.parse(step.time_range.start)) + 6, g.lowY, "Start a transaction here");
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
  record("(a) the report's clicks: Start a transaction here 6 px after a step's start starts it at the step's start (it snaps); the transaction is drawn at once where it was put, pending, with no bar under it; it applies itself with no click and no question (a project made from a video) and the step is in the transaction",
    !a.err && a.snapped && a.bandAtStep && a.pending.bars === 0 &&
      /Not applied yet: Apply marker changes/.test(a.pending.title) && /open: no end marked yet/.test(a.pending.title) && /Drag its start or its end to move it, or right-click where it ends: End the transaction here[.]/.test(a.pending.title) &&
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
  record("(c) the transaction's start dragged twice, the second time to 4 px from the step's start: it snaps there, the band stands there pending; applied by itself, the transaction starts at the step and holds it",
    !c.err && c.band.pending && c.bandAtStep && c.asked === false && c.snapped && c.inRun &&
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
        apply: !!t.querySelector(".run-times-apply") };
    });
    hT.asked = await apply();
    hT.start = (await runs())[0].start_ts;
    hT.startOk = Date.parse(hT.start) === Date.parse(earlier);
  } catch (e) { hT.err = errText(e); }
  record("(h) an open transaction's Starts at typed: the field dashed, Updates in a moment and no Apply button beside it; it applies itself with no question (a project made from a video): the transaction starts there",
    !hT.err && hT.pending.note === "Updates in a moment" && hT.pending.apply === false && hT.asked === false && hT.startOk,
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
    await apply();
    iT.end = (await runs())[0].end_ts;
    iT.endOk = !!iT.end && Date.parse(iT.end) === Date.parse(at);
    await openTransaction();
    await typeIn(txField("end"), "");
    await apply();
    iT.endAfter = (await runs())[0].end_ts;
  } catch (e) { iT.err = errText(e); }
  record("(i) its Ends at, \"open\" while it runs to the end, typed adds its End (applied there); emptied, the End goes and it runs to the end again",
    !iT.err && iT.before.value === "" && iT.before.placeholder === "open" && iT.endOk && iT.endAfter == null,
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
    jT.empty = await page.evaluate(() => document.getElementById("step-start").value === "" &&
      !!document.getElementById("step-end") && document.getElementById("step-end").disabled);
    await typeIn(page.locator("#step-start"), "0:01");
    await page.waitForFunction((sid) => {
      const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && s.time_range && s.time_range.start;
    }, added.step_id, { timeout: T });
    const placed = await stepById(added.step_id);
    // Until the next step starts or the next transaction boundary (2.0.3).
    const nextStep = (await anno()).steps.filter((s) => s.step_id !== added.step_id && s.time_range && s.time_range.start)
      .map((s) => Date.parse(s.time_range.start)).filter((x) => x > origin + 1000).sort((a, b) => a - b)[0];
    const nextMark = await page.evaluate((after) => {
      const ME = require("./marker-edits.js");
      return ME.currentMarkerEvents(ME.sessionMarkerView(require("./state.js").getSession()))
        .map((e) => Date.parse(e.timestamp)).filter((x) => x > after).sort((a, b) => a - b)[0] || null;
    }, origin + 1000);
    const next = nextMark != null && nextMark < nextStep ? nextMark : nextStep;
    jT.span = [clockOf(placed.time_range.start), Date.parse(placed.time_range.end) === next];
    await level("flow");
    jT.band = await page.evaluate((sid) => !!document.querySelector('#timeline .tl-step-band[data-step-id="' + sid + '"]'), added.step_id);
  } catch (e) { jT.err = errText(e); }
  record("(j) a step added with + Add step has no time: its line says \"no time yet\" with its start and end fields, the end waiting for the start; a start typed gives it one, until the next step starts or the next transaction boundary, and a band on the Timeline",
    !jT.err && /no time yet: to$/.test(jT.line) && jT.empty && jT.span[0] === "0:01" && jT.span[1] === true && jT.band,
    JSON.stringify(jT));

  // ================= "The duration is endless" (the owner's next report) =================
  const PROJ2 = path.join(TMP, "Order call 2");
  let origin2 = NaN;
  const clock2 = (ms) => { const t = Math.round((ms - origin2) / 100); const s = Math.floor(t / 10);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + (t % 10 ? "." + (t % 10) : ""); };
  const at2 = (text) => { const [m, s] = text.split(":"); return origin2 + Math.round((Number(m) * 60 + Number(s)) * 1000); };
  const ms = (iso) => Date.parse(iso);

  // (k) The one unmarked transaction of a new project: both fields at once.
  let kT = {};
  try {
    await stubOpen(VIDEO);
    await stubSave(PROJ2);
    await page.click("#btn-new-menu");
    await page.click("#btn-new-from-video");
    await page.waitForFunction((f) => { const s = require("./state.js").getSession();
      return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase() && !!s.stats && !document.getElementById("run-status"); },
    path.resolve(PROJ2), { timeout: 120000 });
    origin2 = Date.parse(readJson(path.join(PROJ2, "manifest.json")).started_at);
    await level("flow");
    await page.waitForFunction(() => /^Video · /.test((document.getElementById("timeline-summary") || {}).textContent || ""), null, { timeout: 30000 });
    await openTransaction();
    kT.before = await page.evaluate(() => [...document.querySelectorAll("#step-list .run-group.open .run-times input")]
      .map((i) => ({ side: i.dataset.side, value: i.value, ph: i.placeholder })));
    await typeIn(txField("start"), "0:02");
    kT.asked = await apply();
    const r = await runs();
    kT.runs = r.map((x) => ({ implicit: !!x.implicit, start: x.start_ts, end: x.end_ts }));
    kT.marked = r.length === 1 && !r[0].implicit && ms(r[0].start_ts) === at2("0:02") && r[0].end_ts == null;
  } catch (e) { kT.err = errText(e); }
  record("(k) a new project's one unmarked transaction shows Starts at and Ends at (\"open\") before any marker; a start typed marks it, and it applies itself with no question",
    !kT.err && kT.before.length === 2 && kT.before[0].side === "start" && kT.before[0].ph === "0:00" &&
      kT.before[1].side === "end" && kT.before[1].ph === "open" && kT.asked === false && kT.marked,
    JSON.stringify(kT));

  // (l) The owner, after 2.0.3: "you always add steps sequentially". Steps
  // added one after another on the Timeline in the open transaction: the
  // first at its start (it snaps there), each next one right-clicked on the
  // band of the one before it, which runs on to the end until then. Each
  // ends the one before it; only the newest is open. The transaction's end,
  // right-clicked on its own band, ends the last step.
  let lT = {};
  const ids = [];
  const bandBox = (id) => page.locator('#timeline .tl-step-band[data-step-id="' + id + '"]').boundingBox({ timeout: T });
  const openBand = (id) => page.evaluate((sid) => { const el = document.querySelector('#timeline .tl-step-band[data-step-id="' + sid + '"]');
    return el ? el.classList.contains("open") : null; }, id);
  const factsOf = () => page.evaluate(() => ({ end: document.getElementById("step-end").value, ph: document.getElementById("step-end").placeholder,
    line: ((document.querySelector("#step-facts .step-facts-rest") || {}).textContent || "").replace(/\s+/g, " ").trim() }));
  try {
    await level("flow");
    let g = await geo();
    await rightClickItem(xOf(g, at2("0:02")) + 3, g.lowY, "Add a step here");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 1, null, { timeout: T });
    ids.push((await anno()).steps[0].step_id);
    lT.firstAtStart = ms((await stepById(ids[0])).time_range.start) === at2("0:02");
    for (const frac of [0.35, 0.55]) {
      g = await geo();
      const box = await bandBox(ids[ids.length - 1]);
      await page.mouse.click(g.left + frac * g.width, box.y + box.height / 2, { button: "right" });
      if (!lT.menu) {
        lT.menu = await page.evaluate(() => ({ head: ((document.querySelector("#tl-ctx-menu .tl-ctx-head") || {}).textContent || ""),
          items: [...document.querySelectorAll("#tl-ctx-menu > div")].map((d) => (d.textContent || "").trim()) }));
      }
      await page.locator("#tl-ctx-menu div", { hasText: "Add a step here" }).click({ timeout: T });
      await page.waitForFunction((k) => (require("./state.js").getSession().annotations.steps || []).length === k, ids.length + 1, { timeout: T });
      ids.push((await anno()).steps.find((s) => !ids.includes(s.step_id)).step_id);
    }
    const st = [];
    for (const id of ids) st.push(await stepById(id));
    lT.chain = st[0].time_range.end === st[1].time_range.start && st[1].time_range.end === st[2].time_range.start;
    lT.lastToEnd = Math.abs(ms(st[2].time_range.end) - (g.first + g.span)) <= 1;
    lT.open = [];
    for (const id of ids) lT.open.push(await openBand(id));
    // In Steps: the newest reads "to open" with no length; the one before it
    // its end and how long it took.
    await openTransaction();
    await selectStep(ids[2]);
    lT.newest = await factsOf();
    await selectStep(ids[1]);
    lT.before = await factsOf();
    // The transaction's end, right-clicked on its own band (open, it runs on
    // to the end too).
    await level("flow");
    g = await geo();
    const tx = await page.locator("#timeline .tl-case-band").first().boundingBox({ timeout: T });
    await page.mouse.click(g.left + 0.75 * g.width, tx.y + tx.height / 2, { button: "right" });
    lT.txMenu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu > div")].map((d) => (d.textContent || "").trim()));
    await page.locator("#tl-ctx-menu div", { hasText: "End the transaction here" }).click({ timeout: T });
    lT.asked = await apply();
    const r = await runs();
    const last = await stepById(ids[2]);
    lT.ended = !!r[0].end_ts && ms(last.time_range.end) === ms(r[0].end_ts);
    lT.openAfter = await openBand(ids[2]);
  } catch (e) { lT.err = errText(e); }
  record("(l) steps added one after another on the Timeline, each right-clicked on the band of the one before it (Add a step here there, under that step's name): each ends the one before it and only the newest is open (fading out; \"to open\" in Steps, no length), the one before it showing its end and how long it took; End the transaction here, right-clicked on the transaction's band, ends the last step (applied by itself)",
    !lT.err && lT.firstAtStart && lT.menu.head === "Step 1" && lT.menu.items.includes("Add a step here") && lT.menu.items.includes("Open in Steps") &&
      lT.chain && lT.lastToEnd && JSON.stringify(lT.open) === "[false,false,true]" &&
      lT.newest.end === "" && lT.newest.ph === "open" && !/took/.test(lT.newest.line) &&
      lT.before.end !== "" && /took/.test(lT.before.line) &&
      lT.txMenu.includes("End the transaction here") && lT.txMenu.includes("Jump to start") &&
      lT.asked === false && lT.ended && lT.openAfter === false,
    JSON.stringify(lT));

  // (m) A mark corrected keeps what is joined to it: the transaction's start
  // typed later takes its first step's start along (it never falls outside
  // again); its end typed later takes its last step's end along.
  let mT = {};
  try {
    await openTransaction();
    await typeIn(txField("start"), "0:03");
    mT.note = await page.evaluate(() => { const t = document.querySelector("#step-list .run-group.open .run-times");
      return { note: ((t.querySelector(".run-times-note") || {}).textContent || "").trim(), apply: !!t.querySelector(".run-times-apply") }; });
    mT.asked = await apply();
    await openTransaction();
    await typeIn(txField("end"), "0:27");
    mT.asked = (await apply()) || mT.asked;
    const r = await runs();
    const first = await stepById(ids[0]), last = await stepById(ids[2]);
    mT.start = ms(r[0].start_ts) === at2("0:03") && ms(first.time_range.start) === at2("0:03") && first.case_id === r[0].case_id;
    mT.end = ms(r[0].end_ts) === at2("0:27") && ms(last.time_range.end) === at2("0:27");
  } catch (e) { mT.err = errText(e); }
  record("(m) a mark corrected keeps what is joined to it: the transaction's Starts at typed later takes its first step's start along, so the step stays in it; its Ends at typed later takes its last step's end along (Updates in a moment, no Apply button, no question)",
    !mT.err && mT.note.note === "Updates in a moment" && !mT.note.apply && mT.asked === false && mT.start && mT.end, JSON.stringify(mT));

  // (n) The inverses: the last step deleted gives its time back to the step
  // before it; a step's end typed earlier, then emptied, runs on again.
  let nT = {};
  try {
    await level("flow");
    const box = await bandBox(ids[2]);
    await page.mouse.click(box.x + 14, box.y + box.height / 2, { button: "right" });
    await page.locator("#tl-ctx-menu div", { hasText: /^Delete step$/ }).click({ timeout: T });
    await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.steps || []).length === 2, null, { timeout: T });
    nT.handedBack = ms((await stepById(ids[1])).time_range.end) === at2("0:27");
    await openTransaction();
    await selectStep(ids[1]);
    await typeIn(page.locator("#step-end"), "0:25");
    await page.waitForFunction(([sid, e]) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && Date.parse(s.time_range.end) === e; }, [ids[1], at2("0:25")], { timeout: T });
    nT.typed = true;
    await selectStep(ids[1]);
    await typeIn(page.locator("#step-end"), "");
    await page.waitForFunction(([sid, e]) => { const s = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid);
      return s && Date.parse(s.time_range.end) === e; }, [ids[1], at2("0:27")], { timeout: T });
    nT.runsOn = true;
  } catch (e) { nT.err = errText(e); }
  record("(n) the inverses: the last step deleted (from its band's right-click) gives its time back to the step before it; a step's end typed earlier and then emptied runs on to its transaction's end again",
    !nT.err && nT.handedBack && nT.typed && nT.runsOn, JSON.stringify(nT));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  await laneE(TMP);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[timeline-edit-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[timeline-edit-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
