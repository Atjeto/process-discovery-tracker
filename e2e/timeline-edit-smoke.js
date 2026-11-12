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
 *       start (it snaps), drawn at once where it was put as any transaction
 *       (no bar under it, nothing about applying, D4); it applies itself a
 *       moment later, with no click and no question, and the step is in the
 *       transaction;
 *   (b) a step's start dragged out of the transaction: the step leaves it at
 *       once (Outside the transactions), its time the one dropped, the time
 *       shown while dragging; Ctrl+Z puts it back, Ctrl+Y again;
 *   (c) the transaction's start dragged to the step's (it snaps): the band
 *       stands there, drawn as any transaction; applied by itself, the step
 *       is in the transaction again;
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
 *   (h) an open transaction's Starts at typed: the field shows it as any
 *       time, with no note and no Apply button beside it (D4); it applies
 *       itself, and the transaction starts there;
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
 * Lane SCREEN, on a third project made from the video:
 *   (s1) to (s4) the screen's order and the timeline's first row: Play, the
 *       clock, Start transaction and End transaction, Add step, Add note,
 *       the messages in the row, the keyboard.
 * Lane LANES, on a fourth project made from the video, then on the recording
 * the smokes use (the demo session, a stretch left out of the analysis):
 *   (t1) to (t8) the lanes in the order of the work, the Steps lane readable
 *       (names on up to two lines, numbers on narrow bands), a stretch set
 *       aside hatched through every lane (a step on it still opens), the bar
 *       of the whole length under the lanes, the legend in the Lanes menu,
 *       a double-click on a transaction showing only it.
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
     (o) E4: a Shift-drag across 0:08 to 0:16 does not start the video, the
         timeline's row shows its times and length and offers "Not part of the process"
         (no "Leave out of the analysis"); one click marks it with no
         question and no analysis: excluded_ranges holds it, the Timeline
         draws it hatched with its label and tooltip, the legend says "not
         part of the process", and Steps says nothing of it;
     (p) playing from 0:06 skips it (no moment inside it is shown), and a
         seek into it plays it from there;
     (q) Include again, from the band's menu, takes it out; Ctrl+Z puts it
         back and Ctrl+Y takes it out again, none of them analyzing;
     (r) E5, lane PANE: each step without a time has Starts here on its row
         in the pane's Steps tab (the toolbar's button is gone); at 0:02, 0:24
         and 0:16 it gives each step its moment in two acts (seek, click),
         the focus on that row: their order in Steps stays as written, each is
         a band, each took the video's frame; then no row offers it; Ctrl+Z gives the
         last one back its no time and takes its frame; the right-click menu
         offers the same act under Add a step here. */
/* Lane LANES (plan section 11.3): the lanes of the timeline. In a project
   made from a video, then in the recording the smokes use (the demo session,
   a stretch left out of the analysis): the lanes in the order of the work,
   the Steps lane 44 px tall with the names readable on its bands (a band too
   narrow shows its number, the pane's), a stretch set aside hatched through
   every lane under the marks (a step on it still opens), the one bar of the
   whole length under the lanes (zoom in twice, drag its box to the end,
   press near its start: the lanes follow; at Show all the box fills it), the
   legend in the Lanes menu, and a double-click on a transaction showing only
   it (Show all comes back). */
async function laneLanes(TMP) {
  const T0 = Date.parse("2026-11-10T09:00:00.000Z");
  const dir = path.join(TMP, "Lanes call");
  fs.mkdirSync(path.join(dir, "video"), { recursive: true });
  fs.copyFileSync(VIDEO, path.join(dir, "video", "call.webm"));
  const started = new Date(T0).toISOString();
  const iso = (s) => new Date(T0 + s * 1000).toISOString();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: "lane-lanes", source: "video", started_at: started, label: "Lanes call" }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  const st = (id, name, a, b) => ({ step_id: id, name, state: "manually_authored", case_id: null, time_range: { start: iso(a), end: iso(b) },
    description: "", evidence: { interaction_event_ids: [], screenshot_refs: [] }, flags: { waste: false } });
  const LONG = "Take the order from the e-mail with the order form attached";
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify({ version: 1, session_id: "lane-lanes",
    steps: [st("s1", LONG, 1, 7), st("s2", "Find the customer", 7, 7.6), st("s3", "Enter the order lines", 9, 15),
      st("s4", "Look at the weather", 17, 20), st("s5", "Send the confirmation to the customer", 22, 30)],
    analyst_notes: [{ id: "n1", at: iso(25), text: "Ask about the weekly limit." }],
    excluded_ranges: [{ start: iso(15.5), end: iso(21.5), reason: "manual" }],
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
    await page.waitForFunction(() => !!require("./views/flow-view-video.js").timelineSpan() &&
      document.querySelectorAll("#timeline .tl-step-band").length === 5, null, { timeout: T });
  } catch (e) {
    record("lane LANES: the project made from a video with five steps, a note and a stretch not part of the process opens", false, errText(e));
    if (v) await v.close();
    return;
  }
  // The lanes, their order, the Steps lane's bands, the hatch.
  const lanesNow = () => page.evaluate(() => {
    const tl = document.getElementById("timeline").getBoundingClientRect();
    const box = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top - tl.top), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; };
    const hatch = document.querySelector("#timeline .tl-left-out");
    const bands = [...document.querySelectorAll("#timeline .tl-step-band")].map((b) => {
      const name = b.querySelector(".tl-step-name"), num = b.querySelector(".tl-step-num");
      const nb = name.getBoundingClientRect();
      return { id: b.dataset.stepId, shows: b.dataset.shows, num: b.dataset.num, box: box(b), font: parseFloat(getComputedStyle(b).fontSize),
        name: !name.hidden ? name.textContent : null, numText: !num.hidden ? num.textContent : null,
        lines: !name.hidden ? Math.round(nb.height / parseFloat(getComputedStyle(name).lineHeight)) : 0,
        inside: !name.hidden ? nb.top >= b.getBoundingClientRect().top - 0.5 && nb.bottom <= b.getBoundingClientRect().bottom + 0.5 : true,
        title: b.title.split("\n")[0] };
    });
    const cells = [...document.querySelectorAll("#tl-lane-names .tl-lane-name")].map((c) => ({ lane: c.dataset.lane, name: c.textContent.trim(), title: c.title }));
    const slots = {};
    for (const c of document.querySelectorAll("#tl-lane-names .tl-lane-name")) slots[c.dataset.lane] = box(c);
    const rows = [...document.querySelectorAll('#tp-steps .tp-item[data-step-id]')].map((li) => ({ id: li.dataset.stepId, num: (li.querySelector(".tp-num") || {}).textContent }));
    return { cells, slots, bands, rows, hatch: hatch ? Object.assign(box(hatch), { label: (hatch.querySelector(".tl-left-out-label") || {}).textContent || "" }) : null,
      lastBottom: Math.max(...[...document.querySelectorAll("#tl-lane-names .tl-lane-name")].map((c) => { const b = c.getBoundingClientRect(); return b.bottom - tl.top; })),
      under: [...document.getElementById("timeline-section").children].filter((c) => c.getClientRects().length).map((c) => c.id),
      gone: ["timeline-legend", "timeline-minimap", "case-scope", "case-scope-select"].filter((id) => document.getElementById(id)) };
  });
  const a = {};
  try {
    a.l = await lanesNow();
  } catch (e) { a.err = errText(e); }
  const L = a.l || { cells: [], bands: [], rows: [], slots: {} };
  const byId = (id) => L.bands.find((b) => b.id === id) || {};
  const rowNum = (id) => (L.rows.find((r) => r.id === id) || {}).num;
  record("(t1) lane LANES: in a project made from a video the lanes read top to bottom Transactions, Steps, Videos, Notes (no Systems lane, no low row in its place); the Steps lane is 44 px tall, its bands 12 px text; a wide band shows its name on up to two lines inside it, a narrow one only its number, the number the pane's Steps tab shows; the tooltip starts with the name",
    !a.err && JSON.stringify(L.cells.map((c) => c.lane)) === '["cases","steps","videos","notes"]' &&
      L.cells.find((c) => c.lane === "steps").title === "Steps: each step in the order of the process; click one to open it beside the video." &&
      L.bands.every((b) => b.font >= 12 && b.title.startsWith(b.name || "") && b.box.h === 38) &&
      byId("s1").shows === "name" && byId("s1").lines === 2 && byId("s1").inside && byId("s1").name === LONG &&
      byId("s2").shows === "number" && byId("s2").numText === rowNum("s2") && byId("s2").title.startsWith("Find the customer") &&
      byId("s5").shows === "name" && byId("s5").lines >= 1 && byId("s5").lines <= 2,
    JSON.stringify(a.err || { cells: L.cells.map((c) => c.lane), bands: L.bands, rows: L.rows }));
  const steps = L.slots.steps || {};
  record("(t2) the stretch not part of the process is hatched through every lane, from the Transactions lane's top to the last lane's foot, under the marks, with its label once at its top; nothing is left under the timeline but the bar (no legend row, no minimap, no Transaction select)",
    !!L.hatch && Math.abs(L.hatch.top - L.slots.cases.top) <= 3 && Math.abs(L.hatch.top + L.hatch.h - L.lastBottom) <= 4 &&
      L.hatch.label === "Not part of the process" && JSON.stringify(L.under) === '["tl-row","tl-lanes","tl-bar-row"]' && L.gone.length === 0,
    JSON.stringify({ hatch: L.hatch, slots: L.slots, lastBottom: L.lastBottom, under: L.under, gone: L.gone, steps }));

  // A step band inside the hatch still opens on a click; the hatch where no
  // mark is opens its menu.
  const b = {};
  try {
    const box4 = await page.locator('#timeline .tl-step-band[data-step-id="s4"]').boundingBox();
    b.top = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el && (el.closest(".tl-step-band") || el).dataset.stepId || el.className; },
      [box4.x + box4.width / 2, box4.y + box4.height / 2]);
    await page.mouse.click(box4.x + box4.width / 2, box4.y + box4.height / 2);
    await page.waitForFunction(() => { const ed = document.getElementById("tp-editor"); return ed && ed.dataset.stepId === "s4"; }, null, { timeout: T });
    b.opened = await page.evaluate(() => ({ step: document.getElementById("tp-editor").dataset.stepId, name: (document.getElementById("step-name") || {}).value }));
    // The hatch below the step, on the Notes lane, where no mark is: its menu.
    const h = await page.locator("#timeline .tl-left-out").boundingBox();
    const y = h.y + h.height - 6;
    b.under = await page.evaluate(([x, yy]) => (document.elementFromPoint(x, yy) || {}).className, [h.x + h.width / 2, y]);
    await page.mouse.click(h.x + h.width / 2, y);
    await page.waitForSelector("#tl-ctx-menu", { timeout: T });
    b.menu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu > div")].map((d) => d.textContent));
    await page.keyboard.press("Escape");
    await page.locator("#tp-panel-steps .tp-back").click({ timeout: T }).catch(() => {});
  } catch (e) { b.err = errText(e); }
  record("(t3) a step band inside the hatch is on top there and opens on a click (beside the video); a click on the hatch where no mark is offers Include again and Go to its start",
    !b.err && b.top === "s4" && b.opened.step === "s4" && b.opened.name === "Look at the weather" && b.under === "tl-left-out" &&
      JSON.stringify(b.menu) === '["Include again","Go to its start"]', JSON.stringify(b));

  // The bar of the whole length.
  const view = () => page.evaluate(() => {
    const sc = document.getElementById("timeline-scroll"), bar = document.getElementById("tl-bar"), box = document.getElementById("tl-bar-box");
    const br = bar.getBoundingClientRect(), xr = box.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    return { left: sc.scrollLeft, shown: sc.clientWidth, whole: sc.scrollWidth, boxL: (xr.left - br.left) / br.width, boxW: xr.width / br.width,
      now: Number(bar.getAttribute("aria-valuenow")), barL: Math.round(br.left), barR: Math.round(br.right), lanesL: Math.round(sr.left), lanesR: Math.round(sr.right),
      hBar: sc.offsetHeight - sc.clientHeight, zoom: require("./state.js").getZoomFactor() };
  });
  const c = {};
  try {
    c.at1 = await view();
    await page.click("#btn-zoom-in");
    await page.click("#btn-zoom-in");
    await wait(200);
    c.zoomed = await view();
    // Drag the box to the end of the bar.
    const bx = await page.locator("#tl-bar-box").boundingBox();
    const bar = await page.locator("#tl-bar").boundingBox();
    await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
    await page.mouse.down();
    await page.mouse.move(bx.x + bx.width / 2 + 40, bx.y + bx.height / 2, { steps: 4 });
    await page.mouse.move(bar.x + bar.width + 60, bx.y + bx.height / 2, { steps: 6 });
    await page.mouse.up();
    await wait(150);
    c.end = await view();
    // Press near the start of the bar: the view centres there (at the start).
    await page.mouse.click(bar.x + bar.width * 0.03, bar.y + bar.height / 2);
    await wait(150);
    c.start = await view();
    // Near the middle: centred on it.
    await page.mouse.click(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
    await wait(150);
    c.mid = await view();
    // Right, with the bar focused, moves the box (not the video).
    const clock = await page.evaluate(() => require("./views/flow-view-video.js").playheadMs());
    await page.focus("#tl-bar");
    await page.keyboard.press("ArrowRight");
    await wait(100);
    c.key = Object.assign(await view(), { clockKept: (await page.evaluate(() => require("./views/flow-view-video.js").playheadMs())) === clock });
    await page.click("#btn-zoom-reset");
    await wait(200);
    c.all = await view();
    c.attrs = await page.evaluate(() => { const bar = document.getElementById("tl-bar"); return { role: bar.getAttribute("role"), controls: bar.getAttribute("aria-controls"),
      orient: bar.getAttribute("aria-orientation"), tab: bar.tabIndex, title: bar.title, h: Math.round(bar.getBoundingClientRect().height),
      track: Math.round(bar.querySelector(".tl-bar-track").getBoundingClientRect().height) }; });
  } catch (e) { c.err = errText(e); }
  const near = (x, y, tol) => Math.abs(x - y) <= (tol || 1.5);
  record("(t4) the bar of the whole length under the lanes, as wide as them (14 px in a 24 px target, a scrollbar to a screen reader with its tooltip): at the whole length its box fills it; zoomed in twice the box is the part shown; dragged to the end the lanes show their end; a press near its start shows the start, one at its middle centres the middle; Right moves the box and not the video; Show all fills it again; the lanes have no scrollbar of their own",
    !c.err && c.at1.boxW > 0.99 && c.at1.boxL < 0.01 && c.at1.hBar === 0 && near(c.at1.barL, c.at1.lanesL, 2) && near(c.at1.barR, c.at1.lanesR, 2) &&
      near(c.zoomed.zoom, 2.25, 0.01) && near(c.zoomed.boxW, c.zoomed.shown / c.zoomed.whole, 0.01) &&
      near(c.end.left, c.end.whole - c.end.shown, 2) && near(c.end.boxL + c.end.boxW, 1, 0.01) && c.end.now === 100 &&
      c.start.left === 0 && c.start.boxL < 0.01 && c.start.now === 0 &&
      near(c.mid.left + c.mid.shown / 2, c.mid.whole / 2, 3) &&
      c.key.left > c.mid.left && c.key.clockKept &&
      c.all.boxW > 0.99 && c.all.left === 0 && c.all.zoom === 1 &&
      c.attrs.role === "scrollbar" && c.attrs.controls === "timeline-scroll" && c.attrs.orient === "horizontal" && c.attrs.tab === 0 && c.attrs.h >= 24 && c.attrs.track === 14 &&
      c.attrs.title === "The whole length of the timeline: drag the box, or click a place to go there.",
    JSON.stringify(c));

  // The Lanes menu: the lanes in the timeline's order, then what the marks mean.
  const m = {};
  try {
    await page.click("#btn-lanes");
    await page.waitForSelector("#lanes-popup", { state: "visible", timeout: T });
    m.menu = await page.evaluate(() => {
      const p = document.getElementById("lanes-popup"), r = p.getBoundingClientRect();
      return { title: document.getElementById("btn-lanes").title, rows: [...p.querySelectorAll("label.cb")].filter((l) => l.checkVisibility()).map((l) => l.textContent.trim()),
        heads: [...p.querySelectorAll(".lanes-popup-title")].filter((h) => h.checkVisibility()).map((h) => h.textContent),
        legend: [...p.querySelectorAll("#lanes-legend > span")].filter((s) => s.checkVisibility()).map((s) => s.textContent.trim()),
        inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth };
    });
    await page.click("#btn-lanes");
  } catch (e) { m.err = errText(e); }
  record("(t5) Lanes: its tooltip says it also shows what the marks mean; its menu lists the lanes in the timeline's order under Show lanes, then What the marks mean with the marks drawn (a note, the stretch in this project's words), inside the window",
    !m.err && m.menu.title === "Choose which lanes the timeline shows, and see what its marks mean" &&
      JSON.stringify(m.menu.rows) === '["Transactions","Steps","Videos","Screenshots","Notes"]' &&
      JSON.stringify(m.menu.heads) === '["Show lanes","What the marks mean"]' &&
      JSON.stringify(m.menu.legend) === '["note","not part of the process"]' && m.menu.inside, JSON.stringify(m));
  record("lane LANES (a project made from a video): zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  await laneLanesRecording(TMP);
}

/* The recording the smokes use (the demo session), with a stretch left out of
   the analysis: the lanes, the hatch through them, the double-click on a
   transaction, the menu at the window's size. */
async function laneLanesRecording(TMP) {
  const SRC = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
  const dir = path.join(TMP, "Lanes recording");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  const anno = JSON.parse(fs.readFileSync(path.join(dir, "annotations.json"), "utf-8"));
  anno.excluded_ranges = [{ start: "2026-05-14T09:02:40Z", end: "2026-05-14T09:03:05Z", reason: "manual" }];
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify(anno, null, 2));
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + dir], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
    // It opens without an analysis: the viewer analyzes it by itself.
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.stats && (s.stats.case_stats || []).length) &&
      !require("./views/flow-view.js").analysisBusy(); }, null, { timeout: 180000 });
    await page.click('.view-mode-btn[data-level="flow"]');
    await page.waitForFunction(() => document.querySelectorAll("#timeline .tl-case-band").length === 4 &&
      document.querySelectorAll("#timeline .tl-step-band").length > 0, null, { timeout: T });
  } catch (e) {
    record("lane LANES: the recording the smokes use opens on the Timeline", false, errText(e));
    if (v) await v.close();
    return;
  }
  const r = {};
  try {
    r.l = await page.evaluate(() => {
      const tl = document.getElementById("timeline").getBoundingClientRect();
      const cells = [...document.querySelectorAll("#tl-lane-names .tl-lane-name")];
      const h = document.querySelector("#timeline .tl-left-out");
      const hb = h.getBoundingClientRect();
      const tx = document.querySelector("#timeline .tl-case-band").getBoundingClientRect();
      return { lanes: cells.map((c) => c.dataset.lane),
        hatchTop: Math.round(hb.top - tl.top), hatchBottom: Math.round(hb.bottom - tl.top),
        casesTop: Math.round(tx.top - tl.top), lastBottom: Math.round(Math.max(...cells.map((c) => c.getBoundingClientRect().bottom)) - tl.top),
        over: document.querySelectorAll("#timeline .tl-left-out-over").length, drafts: document.querySelectorAll("#timeline .tl-step-band.draft").length,
        dashed: getComputedStyle(document.querySelector("#timeline .tl-step-band.draft")).borderTopStyle };
    });
  } catch (e) { r.err = errText(e); }
  const RL = r.l || {};
  record("(t6) lane LANES: in the recording the lanes read Transactions, Steps, Systems (Idle off until chosen); its drafts are dashed; the stretch left out of the analysis is hatched from the Transactions lane down through the Systems lane",
    !r.err && JSON.stringify(RL.lanes) === '["cases","steps","activity"]' && RL.drafts > 0 && RL.dashed === "dashed" &&
      Math.abs(RL.hatchTop - RL.casesTop) <= 3 && Math.abs(RL.hatchBottom - RL.lastBottom) <= 4 && RL.over === 1, JSON.stringify(r));

  // A double-click on Transaction 2 shows only it, the clock where it was.
  const d = {};
  try {
    const span = () => page.evaluate(() => {
      const sp = require("./views/flow-view-video.js").timelineSpan();
      const sc = document.getElementById("timeline-scroll");
      const whole = sp.endMs - sp.startMs;
      return { from: sp.startMs + (sc.scrollLeft / sc.scrollWidth) * whole, to: sp.startMs + ((sc.scrollLeft + sc.clientWidth) / sc.scrollWidth) * whole,
        clock: require("./views/flow-view-video.js").playheadMs(), zoom: require("./state.js").getZoomFactor() };
    });
    // The clock at a moment of Transaction 4 first (no video: the
    // timeline's own moment), so keeping it means something.
    await page.evaluate(() => require("./views/flow-view-video.js").movePlayheadToTimestamp("2026-05-14T09:04:40.000Z"));
    await wait(700);
    d.before = await span();
    const tx2 = page.locator("#timeline .tl-case-band").nth(1);
    d.tx = await tx2.evaluate((b) => ({ start: Number(b.dataset.startMs), end: Number(b.dataset.endMs), title: b.title }));
    await tx2.dblclick({ position: { x: 30, y: 6 } });
    await wait(500);
    d.after = await span();
    await page.click("#btn-zoom-reset");
    await wait(200);
    d.all = await span();
    // A single click still goes to the transaction's start (a moment later).
    await tx2.click({ position: { x: 30, y: 6 } });
    await wait(600);
    d.single = await span();
  } catch (e) { d.err = errText(e); }
  const len = d.tx ? d.tx.end - d.tx.start : 0;
  record("(t7) a double-click on Transaction 2 shows only it, filling the width with a little room on each side, and the clock stays where it was; its tooltip says so; Show all comes back to the whole length; a single click still goes to its start",
    !d.err && /\nDouble-click: show only this transaction\.$/.test(d.tx.title) && d.after.zoom > 2 &&
      d.after.from <= d.tx.start && d.tx.start - d.after.from <= len * 0.08 && d.after.to >= d.tx.end && d.after.to - d.tx.end <= len * 0.08 &&
      d.before.clock === Date.parse("2026-05-14T09:04:40.000Z") && d.after.clock === d.before.clock && d.all.zoom === 1 && d.all.from === d.before.from &&
      d.single.clock === d.tx.start && d.single.zoom === 1,
    JSON.stringify(d));

  const n = {};
  try {
    await page.click("#btn-lanes");
    await page.waitForSelector("#lanes-popup", { state: "visible", timeout: T });
    n.menu = await page.evaluate(() => {
      const p = document.getElementById("lanes-popup"), r = p.getBoundingClientRect();
      return { rows: [...p.querySelectorAll("label.cb")].filter((l) => l.checkVisibility()).map((l) => l.textContent.trim()),
        legend: [...p.querySelectorAll("#lanes-legend > span:not(.legend-apps)")].filter((s) => s.checkVisibility()).map((s) => s.textContent.trim()),
        systems: p.querySelectorAll("#legend-apps .legend-app").length, inside: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth };
    });
    await page.click("#btn-lanes");
    // The row at this size: nothing cut (the select is gone).
    n.row = await page.evaluate(() => [...document.querySelectorAll("#tl-row button, #tl-row .tl-message")].filter((e) => e.getClientRects().length)
      .map((e) => ({ id: e.id, w: Math.round(e.getBoundingClientRect().width), cut: e.tagName === "BUTTON" && e.scrollWidth > e.clientWidth + 1 })));
  } catch (e) { n.err = errText(e); }
  record("(t8) in the recording the Lanes menu lists Transactions, Steps, Systems, Screenshots, Idle, then what the marks mean (the systems' colours, dashed: a draft step, the stretch left out), inside the window; the row cuts no button",
    !n.err && JSON.stringify(n.menu.rows) === '["Transactions","Steps","Systems","Screenshots","Idle"]' &&
      JSON.stringify(n.menu.legend) === '["dashed: a draft step","left out of the analysis"]' && n.menu.systems >= 3 && n.menu.inside &&
      n.row.every((x) => !x.cut), JSON.stringify(n));
  record("lane LANES (the recording): zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
}

/* ---- Lane SCREEN: the timeline's first row (plan section 11.3) -----------
   A project made from the synthetic video, no step, in a viewer of its own:
     (s1) the screen's order: the stage (the video and the pane) above the
          timeline, the timeline the window's full width at its bottom, the
          page with no scrollbar of its own; no playback bar, and the video
          has no controls of its own;
     (s2) Play and Pause in the row (its name following its state); the
          clock typed: a time that cannot be read says so in the row's
          message area (an error, in the live region), Escape leaves it,
          "0:05" goes there;
     (s3) Start transaction at 0:05 (its question in its words), the button
          then reads End transaction; End transaction at 0:20; Add step at
          0:10 says "Step added at 0:10."; Add note puts a note there and the
          Notes tab counts it; every message reads in the row;
     (s4) Tab reaches the row's controls in their order, each named, each
          with a focus ring; Space on a focused button works it;
     (s5) while the video plays, Start transaction (the row's, and the
          right-click's) adds the start at once with no name and no
          question; paused, it asks, as in (s3). */
async function laneScreen(TMP) {
  const T0 = Date.parse("2026-11-10T09:00:00.000Z");
  const dir = path.join(TMP, "Row call");
  fs.mkdirSync(path.join(dir, "video"), { recursive: true });
  fs.copyFileSync(VIDEO, path.join(dir, "video", "call.webm"));
  const started = new Date(T0).toISOString();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: "lane-screen", source: "video", started_at: started, label: "Row call" }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify({ version: 1, session_id: "lane-screen", steps: [],
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
    await wait(600);
  } catch (e) {
    record("lane SCREEN: the project made from a video opens", false, errText(e));
    if (v) await v.close();
    return;
  }
  const ev = (fn, a) => page.evaluate(fn, a);
  const at = () => ev(() => require("./views/flow-view-video.js").playheadMs());
  const msg = () => ev(() => { const t = document.getElementById("toast"); return { text: t.textContent, place: t.parentNode && t.parentNode.id,
    role: t.getAttribute("role"), error: t.classList.contains("error"), shown: t.classList.contains("show") }; });
  const calm = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy() && !document.getElementById("run-status") &&
    !require("./marker-edits.js").pendingEditCount((require("./state.js").getSession().annotations || {}).marker_edits,
      require("./marker-edits.js").lastAnalysisMs(require("./state.js").getSession())), null, { timeout: 60000 });
  const txText = () => ev(() => document.getElementById("btn-tl-transaction").textContent);
  const goTo = async (t) => {
    await page.click("#btn-tl-clock");
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "tl-clock-field");
    await page.keyboard.type(t);
    await page.keyboard.press("Enter");
    await wait(400);
  };

  // (s1) the order of the screen.
  const s1 = {};
  try {
    Object.assign(s1, await ev(() => {
      const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom }; };
      const view = document.getElementById("view-session");
      return { win: [innerWidth, innerHeight], video: r("#video-pane"), pane: r("#timeline-pane"), tl: r("#timeline-section"),
        scrolls: view.scrollHeight > view.clientHeight || document.documentElement.scrollHeight > document.documentElement.clientHeight,
        bar: !!document.getElementById("playback-bar"), controls: document.getElementById("video").controls };
    }));
  } catch (e) { s1.err = errText(e); }
  record("(s1) lane SCREEN: the video and the pane side by side above the timeline, the timeline the window's full width at its bottom, the page without a scrollbar of its own; no playback bar, and the video has no controls of its own",
    !s1.err && s1.tl.x === 0 && s1.tl.w === s1.win[0] && Math.abs(s1.tl.bottom - s1.win[1]) <= 1 &&
      s1.video.bottom <= s1.tl.y && s1.pane.bottom <= s1.tl.y && s1.video.x + s1.video.w <= s1.pane.x && Math.abs(s1.video.y - s1.pane.y) <= 1 &&
      s1.video.w <= 0.58 * s1.win[0] + 1 && !s1.scrolls && !s1.bar && !s1.controls, JSON.stringify(s1));

  // (s2) Play, Pause and the clock.
  const s2 = {};
  try {
    await page.click("#btn-tl-play");
    await wait(900);
    s2.playing = await ev(() => ({ on: !document.getElementById("video").paused, name: document.getElementById("btn-tl-play").getAttribute("aria-label") }));
    await page.click("#btn-tl-play");
    await wait(300);
    s2.paused = await ev(() => ({ on: document.getElementById("video").paused, name: document.getElementById("btn-tl-play").getAttribute("aria-label") }));
    await page.click("#btn-tl-clock");
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "tl-clock-field");
    await page.keyboard.type("abc");
    await page.keyboard.press("Enter");
    await wait(200);
    s2.bad = await msg();
    await page.keyboard.press("Escape");
    await wait(200);
    s2.escaped = await ev(() => !document.getElementById("btn-tl-clock").hidden && document.getElementById("tl-clock-field").hidden);
    await goTo("0:05");
    s2.at = (await at()) - T0;
    s2.clock = await ev(() => document.getElementById("btn-tl-clock").textContent);
  } catch (e) { s2.err = errText(e); }
  record("(s2) the row: Play plays and its name reads Pause, Pause pauses; a time that cannot be read says \"Type a time such as 6:20.\" in the row's message area (an error, role alert), Escape leaves the clock as it was, 0:05 typed goes there",
    !s2.err && s2.playing.on && s2.playing.name === "Pause" && s2.paused.on && s2.paused.name === "Play" &&
      s2.bad.text === "Type a time such as 6:20." && s2.bad.place === "tl-message" && s2.bad.error && s2.bad.role === "alert" && s2.bad.shown &&
      s2.escaped && Math.abs(s2.at - 5000) < 300 && /^0:05 \/ 0:3\d$/.test(s2.clock), JSON.stringify(s2));

  // (s3) mark a transaction from 0:05 to 0:20, a step at 0:10 and a note.
  const s3 = {};
  try {
    s3.before = await txText();
    await page.click("#btn-tl-transaction");
    await page.waitForSelector(".modal-prompt .modal-input", { timeout: T });
    s3.question = await ev(() => { const m = document.querySelector(".modal-prompt .modal"); return { title: document.getElementById(m.getAttribute("aria-labelledby")).textContent,
      ok: document.querySelector(".modal-prompt .modal-ok").textContent }; });
    await page.click(".modal-prompt .modal-ok");
    await page.waitForFunction(() => document.querySelectorAll(".tl-case-band").length === 1, null, { timeout: T });
    s3.started = await msg();
    await calm();
    s3.reads = await txText();
    await goTo("0:20");
    await page.click("#btn-tl-transaction");
    await page.waitForFunction(() => { const b = document.querySelector(".tl-case-band"); return b && !b.classList.contains("dangling"); }, null, { timeout: T });
    s3.ended = await msg();
    await calm();
    s3.after = await txText();
    await goTo("0:10");
    await page.click("#btn-add-step");
    await page.waitForFunction(() => document.querySelectorAll(".tl-step-band").length === 1, null, { timeout: T });
    await wait(300);
    s3.step = await msg();
    await page.click("#btn-tl-note");
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains("modal-input"), null, { timeout: T });
    await page.keyboard.type("Ask about the stock check");
    await page.click(".modal-prompt .modal-ok");
    await page.waitForFunction(() => document.querySelectorAll(".tl-note").length === 1, null, { timeout: T });
    s3.notes = await ev(() => document.getElementById("tp-tab-notes").getAttribute("aria-label"));
    const a = await ev(() => require("./state.js").getSession().annotations);
    s3.saved = { markers: (a.marker_edits || []).map((m) => [m.marker_type, (Date.parse(m.timestamp) - Date.parse("2026-11-10T09:00:00.000Z")) / 1000]),
      note: ((a.analyst_notes || [])[0] || {}).at ? (Date.parse(a.analyst_notes[0].at) - Date.parse("2026-11-10T09:00:00.000Z")) / 1000 : null,
      step: a.steps.length };
  } catch (e) { s3.err = errText(e); }
  record("(s3) Start transaction at 0:05 (its question titled and confirmed in its own words), the button then reads End transaction; End transaction at 0:20; Add step at 0:10 says \"Step added at 0:10.\"; Add note at 0:10 and the Notes tab counts it; each message in the row",
    !s3.err && s3.before === "Start transaction" && s3.question.title === "Start transaction" && s3.question.ok === "Start transaction" &&
      s3.started.text === "Transaction started at 0:05." && s3.started.place === "tl-message" && s3.started.role === "status" &&
      s3.reads === "End transaction" && s3.ended.text === "Transaction ended at 0:20." && s3.after === "Start transaction" &&
      s3.step.text === "Step added at 0:10." && s3.step.place === "tl-message" && s3.notes === "Notes (1)" &&
      JSON.stringify(s3.saved.markers) === '[["start",5],["end",20]]' && Math.abs(s3.saved.note - 10) < 0.3 && s3.saved.step === 1,
    JSON.stringify(s3));

  // (s5) while the video plays, Start transaction asks nothing: the start is
  // added at once with no name (the rule Add step follows); the right-click's
  // Start a transaction here the same. Paused, it asks, as (s3) shows.
  const s5 = {};
  try {
    await goTo("0:22");
    const bands = () => ev(() => document.querySelectorAll(".tl-case-band").length);
    s5.before = await bands();
    await page.click("#btn-tl-play");
    await page.waitForFunction(() => !document.getElementById("video").paused, null, { timeout: T });
    await page.click("#btn-tl-transaction");
    await wait(900);
    s5.rowDialog = await ev(() => !!document.querySelector(".modal-prompt"));
    s5.rowBands = await bands();
    s5.rowSaid = (await msg()).text;
    s5.stillPlaying = await ev(() => !document.getElementById("video").paused);
    const g = await ev(() => { const r = document.getElementById("timeline").getBoundingClientRect(); const sp = require("./views/flow-view-video.js").timelineSpan();
      const x = r.left + ((Date.parse("2026-11-10T09:00:28.000Z") - sp.startMs) / (sp.endMs - sp.startMs)) * r.width;
      for (let y = r.bottom - 3; y > r.top; y -= 2) if (document.elementFromPoint(x, y) === document.getElementById("timeline")) return { x, y };
      return null; });
    await page.mouse.click(g.x, g.y, { button: "right" });
    await page.locator("#tl-ctx-menu div", { hasText: /^Start a transaction here/ }).click({ timeout: T });
    await wait(900);
    s5.menuDialog = await ev(() => !!document.querySelector(".modal-prompt"));
    s5.menuBands = await bands();
    s5.labels = await ev(() => (require("./state.js").getSession().annotations.marker_edits || []).filter((m) => m.marker_type === "start").map((m) => m.label));
    await ev(() => document.getElementById("video").pause());
  } catch (e) { s5.err = errText(e); }
  record("(s5) while the video plays, Start transaction and the right-click's Start a transaction here add the start at once, with no name and no question, and the video plays on; the message stays \"Transaction started at 0:22.\"",
    !s5.err && !s5.rowDialog && s5.rowBands === s5.before + 1 && /^Transaction started at 0:2\d\.$/.test(s5.rowSaid || "") && s5.stillPlaying &&
      !s5.menuDialog && s5.menuBands === s5.before + 2 && JSON.stringify(s5.labels.slice(-2)) === "[null,null]", JSON.stringify(s5));

  // (s4) the keyboard.
  const s4 = {};
  try {
    await page.click("#tp-tab-steps");
    s4.order = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const f = await ev(() => { const a = document.activeElement; if (!a || !a.closest("#tl-row")) return null; const cs = getComputedStyle(a);
        return { id: a.id, name: a.getAttribute("aria-label") || a.textContent.trim(), ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 }; });
      if (f) { if (s4.order.length && s4.order[s4.order.length - 1].id === f.id) break; s4.order.push(f); }
      else if (s4.order.length) break;
    }
    await ev(() => document.getElementById("btn-tl-play").focus());
    await page.keyboard.press("Space");
    await wait(800);
    s4.spacePlays = await ev(() => !document.getElementById("video").paused);
    await page.keyboard.press("Enter");
    await wait(300);
    s4.enterPauses = await ev(() => document.getElementById("video").paused);
  } catch (e) { s4.err = errText(e); }
  record("(s4) Tab reaches the row in its order (Play, the clock, the speed (lane W2), Add step, the transaction, Add note, Lanes, Zoom out, Show all, Zoom in; lane LANES: no Transaction select), each named and with a focus ring; Space and Enter work a focused button",
    !s4.err && JSON.stringify(s4.order.map((o) => o.id)) === JSON.stringify(["btn-tl-play", "btn-tl-clock", "tl-speed", "btn-add-step", "btn-tl-transaction", "btn-tl-note",
      "btn-lanes", "btn-zoom-out", "btn-zoom-reset", "btn-zoom-in"]) && s4.order.every((o) => o.name && o.ring) &&
      s4.spacePlays && s4.enterPauses, JSON.stringify(s4));
  record("lane SCREEN: zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
}

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
    // Lane SCREEN: the timeline's row shows the stretch (its times and its
    // length) and its acts, the first one filled; no card over the lanes.
    o.card = await page.evaluate(() => [...document.querySelectorAll("#tl-selection button")].filter((b) => !b.hidden).map((b) => b.textContent));
    o.filled = await page.evaluate(() => document.getElementById("tl-selection-exclude").classList.contains("primary"));
    o.rows = await page.evaluate(() => ({ times: document.getElementById("tl-selection-times").textContent, cardGone: !document.getElementById("tl-selection-stats") }));
    o.tip = await page.evaluate(() => document.getElementById("tl-selection-exclude").title);
    await page.click("#tl-selection-exclude");
    await page.waitForFunction(() => (require("./state.js").getSession().annotations.excluded_ranges || []).length === 1, null, { timeout: T });
    o.dialog = await page.evaluate(() => !!document.querySelector(".modal-confirm"));
    o.toast = await page.evaluate(() => document.getElementById("toast").textContent);
    await wait(500);
    o.busy = await busy();
    const r = (await anno()).excluded_ranges[0];
    o.range = [sec(Date.parse(r.start)), sec(Date.parse(r.end))];
    // Lane LANES: what the marks mean is in the Lanes menu.
    await page.click("#btn-lanes");
    o.drawn = await page.evaluate(() => {
      const b = document.querySelector("#timeline .tl-left-out");
      const lg = document.querySelector("#lanes-legend .lg-left-out");
      return { title: b && b.title, label: (document.querySelector(".tl-left-out-label") || {}).textContent,
        legend: lg && lg.textContent, legendTip: lg && lg.title, legendShown: !!lg && lg.checkVisibility() };
    });
    await page.click("#btn-lanes");
    await page.click('.view-mode-btn[data-level="steps"]');
    await wait(400);
    o.steps = await page.evaluate(() => ({ notes: document.querySelectorAll('.run-notes li[data-kind="left_out"]').length,
      text: /left out of the analysis|not part of the process/i.test(document.getElementById("session-layout-steps").innerText) }));
    await page.click('.view-mode-btn[data-level="flow"]');
    await wait(400);
  } catch (e) { o.err = errText(e); }
  record("(o) lane E, E4: in a project made from a video a Shift-drag (which does not start the video) shows the stretch's times and length in the timeline's row and offers Not part of the process (filled, not Leave out of the analysis), Make it a transaction and Clear selection; one click marks it with no question and no analysis (\"Marked as not part of the process.\"), hatched with its label and tooltip, the legend in its words, and Steps says nothing of it",
    !o.err && o.pausedBefore && o.pausedAfter && /^0:0\d to 0:1\d · \ds$/.test(o.rows.times) && o.rows.cardGone &&
      JSON.stringify(o.card) === '["Not part of the process","Make it a transaction","Clear selection"]' && o.filled && !o.dialog &&
      o.tip === "Marks the selected stretch as not part of the process: playing skips it." &&
      /Marked as not part of the process\./.test(o.toast || "") &&
      !o.busy.busy && !o.busy.status && Math.abs(o.range[0] - 8) <= 0.3 && Math.abs(o.range[1] - 16) <= 0.3 &&
      /^Not part of the process: 0:0\d to 0:1\d\. Click it to include it again\.$/.test(o.drawn.title || "") && o.drawn.label === "Not part of the process" &&
      o.drawn.legend === "not part of the process" &&
      o.drawn.legendTip === "A stretch you marked as not part of the process: playing skips it." &&
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
    // Lane LANES: the hatch runs through every lane under the marks; a click
    // where no mark is.
    await page.mouse.click(...(await page.evaluate(() => {
        const h = document.querySelector("#timeline .tl-left-out"), r = h.getBoundingClientRect(), x = r.left + r.width / 2;
        for (let y = r.bottom - 2; y > r.top; y -= 2) if (document.elementFromPoint(x, y) === h) return [x, y];
        return [x, r.bottom - 2];
      })));
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
    // Lane PANE: the act sits on the step, on its row in the pane's Steps
    // tab beside the video (Starts here); the toolbar's button is gone.
    const button = () => page.evaluate(() => {
      const heres = [...document.querySelectorAll("#tp-steps .tp-item .tp-here")];
      const b = heres[0] || null;
      return { toolbar: !!document.getElementById("btn-show-here"), tab: document.getElementById("tp-tab-steps").getAttribute("aria-selected"),
        ids: heres.map((x) => x.dataset.here), text: b ? b.textContent : null, title: b ? b.title : null,
        hint: ((document.querySelector("#tp-steps .tp-hint") || {}).textContent || "").trim(),
        oneLine: !!b && b.getBoundingClientRect().height < 40 && Math.abs(b.getBoundingClientRect().top - b.closest(".tp-item").querySelector(".tp-row").getBoundingClientRect().top) < 30 };
    });
    await page.locator("#tp-tab-steps").click({ timeout: T });
    r5.first = await button();
    r5.acts = [];
    for (const [s, id] of [[2, "n1"], [24, "n2"], [16, "n3"]]) {
      await seek(s);
      const before = await button();
      await page.locator('#tp-steps .tp-item[data-step-id="' + id + '"] .tp-here').click({ timeout: T });
      await page.waitForFunction((sid) => { const st = require("./state.js").getSession().annotations.steps.find((x) => x.step_id === sid); return !!(st && st.time_range); }, id, { timeout: T });
      await wait(400);
      const after = await button();
      r5.acts.push({ offered: before.ids.join(","), at: s, left: after.ids.join(","), focus: await page.evaluate(() => ((document.activeElement || {}).dataset || {}).stepId || null) });
      if (id === "n1") r5.toast = await page.evaluate(() => document.getElementById("toast").textContent);
    }
    const a = await anno();
    r5.times = a.steps.map((s) => s.step_id + "@" + (s.time_range ? sec(Date.parse(s.time_range.start)) : "-"));
    r5.frames = ["n1", "n2", "n3"].map((id) => (a.analyst_screenshots || []).some((x) => x.step_id === id && x.source === "video_frame"));
    r5.bands = await page.evaluate(() => [...document.querySelectorAll("#timeline .tl-step-band")].map((b) => b.dataset.stepId).sort().join(","));
    r5.after = await button();
    await page.click('.view-mode-btn[data-level="steps"]');
    await wait(400);
    r5.rows = await page.evaluate(() => [...document.querySelectorAll("#step-list .step-row[data-step-id]")].map((x) => x.dataset.stepId).join(","));
    await page.click('.view-mode-btn[data-level="flow"]');
    await wait(400);
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => !require("./state.js").getSession().annotations.steps.find((x) => x.step_id === "n3").time_range, null, { timeout: T });
    await wait(400);
    const u = await anno();
    r5.undo = { frame: (u.analyst_screenshots || []).some((x) => x.step_id === "n3"), button: (await button()).ids.join(",") };
    const g = await geom();
    const xr = g.left + ((T0 + 29000 - g.first) / g.span) * g.width;
    await page.mouse.click(xr, await bgY(g, xr), { button: "right" });
    r5.menu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu div")].map((d) => d.textContent));
    await page.keyboard.press("Escape");
  } catch (e) { r5.err = errText(e); }
  const menuAt = r5.menu ? r5.menu.indexOf("Add a step here") : -1;
  record("(r) lane E, E5, lane PANE: in the pane's Steps tab each of the three steps written first has Starts here on its row (the toolbar's button is gone) under the hint \"3 steps have no time yet...\"; go to the moment, click it, two acts each (\"Open the order\" starts at 0:02.), the focus staying on that row; their order in Steps stays as written, each is a band with the video's frame; then no row offers it and the hint goes; Ctrl+Z gives the last its no time back (its Starts here again) and takes its frame; the right-click menu offers \"Send the invoice\" starts here under Add a step here",
    !r5.err && !r5.first.toolbar && r5.first.tab === "true" && r5.first.text === "Starts here" && r5.first.oneLine &&
      r5.first.title === "Sets the start of this step to the moment the video shows now." &&
      r5.first.hint === "3 steps have no time yet. Go to the moment a step starts in the video, then click Starts here on that step." &&
      /"Open the order" starts at 0:02\./.test(r5.toast || "") &&
      JSON.stringify(r5.acts) === JSON.stringify([{ offered: "n1,n2,n3", at: 2, left: "n2,n3", focus: "n1" }, { offered: "n2,n3", at: 24, left: "n3", focus: "n2" },
        { offered: "n3", at: 16, left: "", focus: "n3" }]) &&
      r5.frames.every(Boolean) && r5.bands === "n1,n2,n3" && r5.after.ids.length === 0 && r5.after.hint === "" && r5.rows === "n1,n2,n3" &&
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
    // Lane E-1, lane PANE: the step just added opens in the pane beside the
    // video, the step panel closed (the timeline keeps its width); 6 px after
    // the step's start is measured again.
    await page.waitForFunction((sid) => (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId === sid &&
      document.getElementById("step-panel").hidden, step.step_id, { timeout: T });
    await wait(300);
    g = await geo();
    await rightClickItem(xOf(g, Date.parse(step.time_range.start)) + 6, g.lowY, "Start a transaction here");
    await prompt("Order 1");
    await page.waitForSelector("#timeline .tl-case-band", { timeout: T });
    g = await geo();
    const ins = (await anno()).marker_edits.find((e) => e.op === "insert");
    a.snapped = ins && ins.timestamp === step.time_range.start;
    a.drawn = await page.evaluate(() => {
      const b = document.querySelector("#timeline .tl-case-band");
      const r = b.getBoundingClientRect();
      return { left: r.left, cls: b.className, bars: document.querySelectorAll("#timeline .tl-marker").length,
        update: !!document.getElementById("btn-update-steps"), title: b.title };
    });
    a.bandAtStep = Math.abs(a.drawn.left - xOf(g, Date.parse(step.time_range.start))) <= 1.5;
    a.asked = await apply();
    const rs = await runs();
    a.runs = rs.map((r) => ({ label: r.label, start: r.start_ts }));
    a.inRun = (await stepById(stepId)).case_id === (rs[0] && rs[0].case_id);
    a.groups = await stepsGroups();
    a.applied = await page.evaluate(() => ({ cls: [...document.querySelectorAll("#timeline .tl-case-band")].map((b) => b.className),
      bands: document.querySelectorAll("#timeline .tl-case-band").length }));
  } catch (e) { a.err = errText(e); }
  record("(a) the report's clicks: Start a transaction here 6 px after a step's start starts it at the step's start (it snaps); the transaction is drawn at once where it was put, as any transaction (D4: no dashed state, nothing about applying), with no bar under it and no button; it applies itself with no click and no question and the step is in the transaction",
    !a.err && a.snapped && a.bandAtStep && a.drawn.bars === 0 && a.drawn.update === false &&
      /^tl-case-band( dangling)?$/.test(a.drawn.cls) && !/appl|pending/i.test(a.drawn.title) &&
      /open: no end marked yet/.test(a.drawn.title) && /Drag its start to move it; right-click where it ends to end it[.]/.test(a.drawn.title) &&
      a.asked === false && a.runs.length === 1 && a.runs[0].label === "Order 1" && a.inRun &&
      JSON.stringify(a.groups) === '["Transaction 1: 1 step"]' && a.applied.bands === 1 && a.applied.cls.every((c) => /^tl-case-band( dangling)?$/.test(c)),
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
    await page.waitForFunction((x) => Math.abs(document.querySelector("#timeline .tl-case-band").getBoundingClientRect().left - x) <= 8, target - 30, { timeout: T });
    await drag("#timeline .tl-case-band", "start", target + 4);
    await wait(300);
    g = await geo();
    c.band = await page.evaluate(() => {
      const el = document.querySelector("#timeline .tl-case-band");
      return { cls: el.className, left: el.getBoundingClientRect().left, update: !!document.getElementById("btn-update-steps") };
    });
    c.bandAtStep = Math.abs(c.band.left - xOf(g, Date.parse(st.time_range.start))) <= 1.5;
    c.asked = await apply();
    const rs = await runs();
    c.runStart = rs[0] && rs[0].start_ts;
    c.snapped = !!c.runStart && Date.parse(c.runStart) === Date.parse(st.time_range.start);
    c.inRun = (await stepById(stepId)).case_id === (rs[0] && rs[0].case_id);
    c.groups = await stepsGroups();
  } catch (e) { c.err = errText(e); }
  record("(c) the transaction's start dragged twice, the second time to 4 px from the step's start: it snaps there, the band stands there drawn as any transaction (D4), no button; applied by itself, the transaction starts at the step and holds it",
    !c.err && /^tl-case-band( dangling)?$/.test(c.band.cls) && !c.band.update && c.bandAtStep && c.asked === false && c.snapped && c.inRun &&
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
    d.cta = await page.$("#btn-update-steps");
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
    // Lane A-2 (audit A18): the reason stays beside the field, under its
    // line, after the message has gone and 5 s on, until the field is edited.
    await wait(5000);
    gT.beside = await page.evaluate(() => {
      const f = document.getElementById("step-start");
      const id = f && f.getAttribute("aria-describedby");
      const n = id ? document.getElementById(id) : null;
      const fr = f && f.getBoundingClientRect(), nr = n && n.getBoundingClientRect();
      return { invalid: f && f.getAttribute("aria-invalid"), role: n && n.getAttribute("role"), text: n ? n.textContent : null,
        shown: !!(n && n.checkVisibility()), px: n ? parseFloat(getComputedStyle(n).fontSize) : 0,
        under: !!(fr && nr && nr.top >= fr.bottom - 2 && nr.top - fr.bottom < 80 && nr.left < fr.right),
        inEditor: !!(n && n.closest("#step-detail, #tp-editor")) };
    });
    await page.click("#step-start");
    await page.keyboard.type("1");
    gT.afterEdit = await page.evaluate(() => {
      const f = document.getElementById("step-start");
      return { invalid: f.getAttribute("aria-invalid"), described: f.getAttribute("aria-describedby"), lines: document.querySelectorAll(".field-refusal").length };
    });
    await page.keyboard.press("Escape");
  } catch (e) { gT.err = errText(e); }
  record("(g) the selected step's start and end are fields on its line of facts: a start typed moves it (before its transaction it leaves it, Ctrl+Z brings it back), Up adds a second and Escape puts it back, a text that is no time and a start after the end are refused, saying why",
    !gT.err && gT.shownOk && gT.shown.label === "Start of this step" && gT.up !== gT.shown.start && gT.escaped &&
      gT.movedIn && gT.left && gT.outside && gT.undone &&
      /^That is not a time: type it the way the timeline shows it/.test(gT.notATime) &&
      /^The start of this step can be from .+ to .+: a step does not run over the steps beside it[.]$/.test(gT.afterEnd) && gT.unchanged,
    JSON.stringify(gT));
  record("(g2) lane A-2: the refusal (a step does not run over the steps beside it) is still on screen beside its field after 5 s: a 12 px alert under the field's line, the field aria-invalid and described by it; the next edit of the field takes it away",
    !gT.err && !!gT.beside && gT.beside.invalid === "true" && gT.beside.role === "alert" && gT.beside.shown && gT.beside.px >= 12 &&
      gT.beside.under && gT.beside.inEditor &&
      /^The start of this step can be from .+ to .+: a step does not run over the steps beside it[.]$/.test(gT.beside.text || "") &&
      !!gT.afterEdit && gT.afterEdit.invalid === null && gT.afterEdit.described === null && gT.afterEdit.lines === 0,
    JSON.stringify({ beside: gT.beside, afterEdit: gT.afterEdit, err: gT.err }));

  // (h) The transaction's Starts at, typed: it applies by itself.
  let hT = {};
  const txField = (side) => page.locator('#step-list .run-group.open .run-times [data-side="' + side + '"]');
  try {
    await openTransaction();
    const run0 = (await runs())[0];
    const earlierText = clockOf(new Date(Date.parse(run0.start_ts) - 1000).toISOString());
    const earlier = typedIso(earlierText);
    await typeIn(txField("start"), earlierText);
    // Saved: a change waits for its run, or the run is under way.
    await page.waitForFunction(() => { const s = require("./state.js").getSession(), ME = require("./marker-edits.js");
      return ME.pendingEditCount(s.annotations.marker_edits, ME.lastAnalysisMs(s)) > 0 || !!document.getElementById("run-status"); }, null, { timeout: T });
    hT.beside = await page.evaluate(() => {
      const t = document.querySelector("#step-list .run-group.open .run-times");
      return { text: (t.textContent || "").replace(/\s+/g, " ").trim(), buttons: t.querySelectorAll("button").length,
        fields: [...t.querySelectorAll("input.time-field")].map((f) => f.className) };
    });
    hT.asked = await apply();
    hT.start = (await runs())[0].start_ts;
    hT.startOk = Date.parse(hT.start) === Date.parse(earlier);
  } catch (e) { hT.err = errText(e); }
  record("(h) an open transaction's Starts at typed: the field shows the time as any field (D4: no dashed state, no note, no Apply button beside it); it applies itself with no question: the transaction starts there",
    !hT.err && hT.beside.text === "Starts at Ends at" && hT.beside.buttons === 0 && hT.beside.fields.every((c) => c === "time-field") &&
      hT.asked === false && hT.startOk,
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
    await page.waitForFunction(() => { const s = require("./state.js").getSession(), ME = require("./marker-edits.js");
      return ME.pendingEditCount(s.annotations.marker_edits, ME.lastAnalysisMs(s)) > 0 || !!document.getElementById("run-status"); }, null, { timeout: T });
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
      lT.txMenu.includes("End the transaction here") && lT.txMenu.includes("Go to its start") &&
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
      return { text: (t.textContent || "").replace(/\s+/g, " ").trim(), buttons: t.querySelectorAll("button").length }; });
    mT.asked = await apply();
    await openTransaction();
    await typeIn(txField("end"), "0:27");
    mT.asked = (await apply()) || mT.asked;
    const r = await runs();
    const first = await stepById(ids[0]), last = await stepById(ids[2]);
    mT.start = ms(r[0].start_ts) === at2("0:03") && ms(first.time_range.start) === at2("0:03") && first.case_id === r[0].case_id;
    mT.end = ms(r[0].end_ts) === at2("0:27") && ms(last.time_range.end) === at2("0:27");
  } catch (e) { mT.err = errText(e); }
  record("(m) a mark corrected keeps what is joined to it: the transaction's Starts at typed later takes its first step's start along, so the step stays in it; its Ends at typed later takes its last step's end along (D4: no note, no Apply button, no question)",
    !mT.err && mT.note.text === "Starts at Ends at" && mT.note.buttons === 0 && mT.asked === false && mT.start && mT.end, JSON.stringify(mT));

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
  await laneScreen(TMP);
  await laneLanes(TMP);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[timeline-edit-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[timeline-edit-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
