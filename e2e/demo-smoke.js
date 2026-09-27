"use strict";
/*
 * demo-smoke.js: the demo project that ships with the app (2.0.1,
 * viewer/demo-project.js, demo/Order to cash).
 *
 * Launches the REAL viewer on a throwaway profile, with PDT_DEMO_DIR naming a
 * temp folder in place of Documents\PDT demo, and checks:
 *   (a) the page shown while no project is open, and the Open menu, offer
 *       Open the demo project;
 *   (b) it opens a fresh copy, "Order to cash" under PDT_DEMO_DIR, as it
 *       ships: no analysis on open, its title, request, video, transcript
 *       and its document written (10 of 10);
 *   (c) the copy holds what the demo is for: the reference transaction
 *       confirmed, a sub-process, a step added by hand, the flow (Only when
 *       and a Decision to a step another transaction did), a waste flag,
 *       notes, attachments, an app outside the process, a stretch left out,
 *       an As-Is and a To-Be map, a hand-off; its step map names each
 *       task's system in a label, with no colour;
 *   (d) a second Open the demo project makes "Order to cash (2)", and the
 *       packaged demo folder is never changed.
 *   Zero page errors.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const DEMO = path.join(REPO, "demo", "Order to cash");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const T = 30000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("demo-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const stamp = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
  const p = path.join(dir, String(f));
  const st = fs.statSync(p);
  return st.isFile() ? f + ":" + st.size : String(f);
}).join("|");

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-demo-"));
  process.env.PDT_DEMO_DIR = TMP;   // the demo's copies, for this run only
  const before = stamp(DEMO);
  let v;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const { app } = v;
  const page = await app.firstWindow();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
  const idle = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 240000 });

  // (a) the offers
  const a = {};
  try {
    await page.waitForSelector("#btn-open-demo-hero", { state: "visible", timeout: T });
    a.hero = ((await page.locator("#btn-open-demo-hero").textContent()) || "").trim();
    await page.click("#btn-recent-menu");
    a.menu = ((await page.locator("#btn-open-demo").textContent({ timeout: T })) || "").trim();
    await page.click("#btn-recent-menu");
  } catch (e) { a.err = errText(e); }
  record("(a) the page shown while no project is open and the Open menu offer Open the demo project",
    !a.err && a.hero === "Open the demo project" && a.menu === "Open the demo project", JSON.stringify(a));

  // (b) a fresh copy, opened as it ships
  const b = {};
  try {
    await page.click("#btn-open-demo-hero");
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: 120000 });
    await wait(1500);
    b.busy = await page.evaluate(() => require("./views/flow-view.js").analysisBusy());
    await idle();
    b.folder = await page.evaluate(() => require("./state.js").getSession().sessionFolder);
    b.line = await page.evaluate(() => ((document.getElementById("ov-summary") || {}).textContent || "").replace(/\s+/g, " ").trim());
    b.status = await page.evaluate(() => ((document.getElementById("ov-doc-status") || {}).textContent || "").trim());
  } catch (e) { b.err = errText(e); }
  record("(b) Open the demo project opens a fresh copy, Order to cash under PDT_DEMO_DIR, with no analysis on open: its title, request, video and transcript on the project line, its document 10 of 10 written",
    !b.err && b.busy === false && !!b.folder && path.resolve(b.folder) === path.join(TMP, "Order to cash") &&
      /^Order to cash: enter a customer order/.test(b.line) && /Request: Order entry review \(REQ-2026-101\)/.test(b.line) &&
      /Video/.test(b.line) && /Transcript/.test(b.line) && b.status === "10 of 10 written", JSON.stringify(b));

  // (c) what the demo holds
  const c = {};
  try {
    const an = readJson(path.join(TMP, "Order to cash", "annotations.json"));
    const steps = an.steps || [];
    const bpmn = fs.readFileSync(path.join(TMP, "Order to cash", "process_map_step.bpmn"), "utf-8");
    c.confirmed = !!(an.pattern_run && an.pattern_run.confirmed_at);
    c.sub = steps.some((s) => (s.sub_steps || []).length >= 2);
    c.added = steps.some((s) => s.state === "manually_authored" && s.name === "Look up the SAP material");
    c.onlyWhen = steps.filter((s) => s.only_when).length;
    c.links = steps.reduce((n, s) => n + (s.links || []).length, 0);
    c.otherTarget = steps.some((s) => (s.links || []).some((l) => {
      const t = steps.find((x) => x.step_id === l.to);
      return t && t.case_id !== s.case_id;
    }));
    c.waste = steps.some((s) => s.flags && s.flags.waste);
    c.notes = (an.analyst_notes || []).length;
    c.attachments = (an.attachments || []).length;
    c.filters = ((an.step_filters || {}).ignored_processes || []).length;
    c.leftOut = (an.excluded_ranges || []).length;
    c.maps = (an.reference_maps || []).map((m) => m.pdd_role).sort().join(",");
    c.handoffs = (an.handoffs || []).length;
    c.labels = /id="TextAnnotation_system(?:_\d+)?"/.test(bpmn);
    c.colours = /\s[\w.-]+:fill="/.test(bpmn);
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await page.waitForSelector("#session-layout-map", { state: "visible", timeout: T });
    await wait(2500);
    c.mapTitle = await page.evaluate(() => ((document.querySelector("#session-layout-map") || {}).textContent || "").includes("As-Is map"));
  } catch (e) { c.err = errText(e); }
  record("(c) the demo shows every part: the reference transaction confirmed, a sub-process, a step added by hand, Only when and Decisions (one to a step another transaction did), waste, notes, attachments, an app outside the process, a stretch left out, an As-Is and a To-Be map, a hand-off; the step map labels each system, with no colour",
    !c.err && c.confirmed && c.sub && c.added && c.onlyWhen >= 2 && c.links >= 3 && c.otherTarget && c.waste &&
      c.notes >= 2 && c.attachments >= 2 && c.filters >= 1 && c.leftOut >= 1 && c.maps === "as_is,to_be" &&
      c.handoffs >= 1 && c.labels && !c.colours && c.mapTitle, JSON.stringify(c));

  // (d) a second copy; the shipped demo untouched
  const d = {};
  try {
    await page.click("#btn-recent-menu");
    await page.click("#btn-open-demo");
    await page.waitForFunction((want) => {
      const s = require("./state.js").getSession();
      return !!s && require("path").resolve(s.sessionFolder) === want;
    }, path.join(TMP, "Order to cash (2)"), { timeout: 120000 });
    d.second = true;
    await idle();
  } catch (e) { d.err = errText(e); }
  d.untouched = stamp(DEMO) === before;
  record("(d) a second Open the demo project opens Order to cash (2), and the demo that ships is never changed",
    !d.err && d.second && d.untouched, JSON.stringify(d));

  record("no page error", errs.length === 0, errs.slice(0, 5).join(" | "));
  await v.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed, ${results.length - passed} failed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("[demo-e2e] crash:", e && e.stack ? e.stack : e); process.exit(2); });
