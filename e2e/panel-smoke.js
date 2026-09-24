"use strict";
/*
 * Step panel e2e smoke (lane V2 items 3, 4 and 5; step-back review 4.5 and
 * 4.6). Launches the REAL viewer on a throwaway profile against a TEMP copy
 * of the demo, analyzed with the current pipeline, and a synthetic 32 s
 * video recorded in the viewer's own window (a canvas and MediaRecorder,
 * kept in the OS temp folder for the next run). Checks:
 *   (a) Attach video copies the video into the recording folder (video/) and
 *       stores its path relative to the folder;
 *   (b) the map boxes name their system under the step name;
 *   (c) the step panel from each of its three doors (a map box, a timeline
 *       step band, a Steps row with Watch) plays the right occurrence in its
 *       own video, beside the content;
 *   (d) closed on Steps, it stays closed while rows are selected;
 *   (e) the folder moved and opened on a fresh profile still has its video,
 *       and an absolute path from another computer falls back to the file of
 *       that name in the folder;
 *   and zero page errors. Exits 0 when every check passed, 1 on a failed
 *   check, 2 when it could not run.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const VIDEO = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");
const T = 20000;
const SEP = " " + String.fromCharCode(45) + " ";   // a window title's separator

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("panel-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

function freshSession() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-panel-"));
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) fs.copyFileSync(path.join(SRC, f), path.join(tmp, f));
  fs.mkdirSync(path.join(tmp, "screenshots"));
  for (const f of fs.readdirSync(path.join(SRC, "screenshots"))) fs.copyFileSync(path.join(SRC, "screenshots", f), path.join(tmp, "screenshots", f));
  const bundled = path.join(VIEWER, "python", "python.exe");
  for (const py of fs.existsSync(bundled) ? [bundled] : ["python", "python3"]) {
    try { execFileSync(py, [path.join(REPO, "normalization", "normalize.py"), tmp, "--mine"], { cwd: REPO, stdio: "ignore" }); return tmp; }
    catch (_) { /* the next interpreter */ }
  }
  return null;
}

async function open(folder, errs) {
  const v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + folder], cwd: VIEWER });
  const page = await v.app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
  return { v, page };
}

/* The panel's state, and where its video is. */
const panelState = (page) => page.evaluate(() => {
  const p = document.getElementById("step-panel");
  const v = document.getElementById("sp-video");
  return {
    shown: !!p && !p.hidden, name: ((document.getElementById("sp-name") || {}).textContent || "").trim(),
    system: ((document.querySelector("#sp-about .sp-system") || {}).textContent || "").trim(),
    count: ((document.querySelector("#sp-about .sp-count") || {}).textContent || "").trim(),
    rows: [...document.querySelectorAll("#sp-body .sp-occ")].map((r) => ({ id: r.dataset.stepId,
      at: ((r.querySelector(".sp-at") || {}).textContent || "").trim(), focus: r.classList.contains("focus") })),
    foot: [...document.querySelectorAll("#sp-body .sp-foot button")].map((b) => (b.textContent || "").trim()),
    video: v ? { t: v.currentTime, paused: v.paused, src: !!v.getAttribute("src") } : null,
  };
});

(async () => {
  const S = freshSession();
  if (!S) { console.log("[panel-e2e] FATAL: no Python with the pipeline dependencies"); process.exit(2); }
  const errs = [];
  const temps = [S];
  let { v, page } = await open(S, errs).catch((e) => { console.error("FATAL:", e); process.exit(2); });

  // The synthetic video: 32 s, each frame showing its own time.
  if (!fs.existsSync(VIDEO)) {
    await page.evaluate(async (out) => {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 180;
      c.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(c);
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(10), { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const t0 = performance.now();
      const draw = () => { g.fillStyle = "#123"; g.fillRect(0, 0, 320, 180); g.fillStyle = "#fff"; g.font = "28px monospace";
        g.fillText("video " + ((performance.now() - t0) / 1000).toFixed(1), 20, 100); };
      draw();
      const iv = setInterval(draw, 100);
      rec.start(1000);
      await new Promise((r) => setTimeout(r, 32000));
      await new Promise((r) => { rec.onstop = r; rec.stop(); });
      clearInterval(iv);
      c.remove();
      require("fs").writeFileSync(out, Buffer.from(await new Blob(chunks, { type: "video/webm" }).arrayBuffer()));
    }, VIDEO);
  }
  const manifest = readJson(path.join(S, "manifest.json"));
  const started = Date.parse(manifest.started_at);

  // (a) Attach video: the two-click sync (video t=0 is the recording's 0:15),
  // and the copy into the folder.
  let attach = {};
  try {
    await v.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, VIDEO);
    await page.locator("#ov-summary #btn-attach-video").click({ timeout: T });
    await page.locator("#video-sync-card .vs-mark").click({ timeout: T });
    await page.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
    const at = await page.evaluate((iso) => {
      const tl = document.getElementById("timeline");
      const evs = require("./state.js").getSession().events;
      const f = Date.parse(evs[0].timestamp), l = Date.parse(evs[evs.length - 1].timestamp);
      const r = tl.getBoundingClientRect();
      return { x: r.left + ((Date.parse(iso) - f) / (l - f)) * r.width, y: r.top + 60 };
    }, new Date(started + 15000).toISOString());
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => /Video attached and synced/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: 60000 });
    attach = readJson(path.join(S, "annotations.json")).external_video || {};
  } catch (e) { attach.err = errText(e); }
  const copied = path.join(S, "video", path.basename(VIDEO));
  record("(a) Attach video copies the video into the recording folder (video/) and stores its path relative to the folder",
    !attach.err && attach.path === "video/" + path.basename(VIDEO) && fs.existsSync(copied) &&
      fs.statSync(copied).size === fs.statSync(VIDEO).size && Math.abs(attach.offset_ms - 15000) <= 2500,
    JSON.stringify(attach));
  await page.waitForFunction(() => !!require("./state.js").getSession().recordingAvailable, null, { timeout: T }).catch(() => {});
  const offset = (readJson(path.join(S, "annotations.json")).external_video || {}).offset_ms || 0;
  const expectAt = (step) => (Date.parse(step.time_range.start) - started - offset) / 1000;
  const anno = readJson(path.join(S, "annotations.json"));
  const run1 = (readJson(path.join(S, "stats.json")).case_stats || []).filter((c) => !c.parent_case_id)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts))[0].case_id;
  const inRun1 = (name) => anno.steps.find((s) => s.case_id === run1 && s.name === name);
  const SAVE = inRun1("Salesforce" + SEP + "Order: Save order");
  const OPEN = inRun1("Salesforce" + SEP + "Account lookup: Open customer record");
  const SEARCH = inRun1("Salesforce" + SEP + "Account lookup: Search");
  /* Play check: the panel's video is at the occurrence's start and plays. */
  const played = async (step) => {
    await wait(1500);
    const st = await panelState(page);
    const want = expectAt(step);
    return { want: Math.round(want * 10) / 10, t: st.video && Math.round(st.video.t * 10) / 10, paused: st.video && st.video.paused,
      ok: !!(st.video && !st.video.paused && st.video.t >= want - 0.3 && st.video.t <= want + 2.5) };
  };

  // (b) + (c1) The map: every box names its system; a box opens the panel.
  let map = {}, fromMap = null;
  try {
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await wait(1500);
    map = await page.evaluate((id) => {
      const cy = document.getElementById("session-map-dfg-host").__cy;
      const n = cy.getElementById(id);
      const all = cy.nodes().map((x) => ({ id: x.id(), system: x.data("system"), label: x.data("label") }));
      n.emit("tap");
      return { all, save: { system: n.data("system"), label: n.data("label") } };
    }, SAVE.name);
    await page.waitForSelector("#step-panel:not([hidden])", { timeout: T });
    const st = await panelState(page);
    await page.locator('#sp-body .sp-occ[data-step-id="' + SAVE.step_id + '"] .sp-play').click({ timeout: T });
    fromMap = Object.assign({ st }, await played(SAVE));
  } catch (e) { map.err = errText(e); }
  record("(b) V2 item 3: every map box names its system under the step name (Salesforce, SAP, Excel, Outlook, Notepad; never the browser)",
    !map.err && map.all.length > 0 && map.all.every((n) => n.system && n.label === n.id + "\n" + n.system) &&
      map.save.system === "Salesforce" && !map.all.some((n) => /Chrome/.test(n.system)),
    JSON.stringify(map.err || map.all.map((n) => n.system)));
  record("(c1) V2 item 4: a map box opens the step panel beside the map (its name, system, runs, one row per occurrence, Open in Steps) and plays the Run 1 occurrence in its video",
    !!(fromMap && fromMap.ok && fromMap.st.shown && fromMap.st.name === SAVE.name && /^Salesforce/.test(fromMap.st.system) &&
      /^In \d of 4 runs, about \d+s each$/.test(fromMap.st.count) && fromMap.st.rows.length >= 3 &&
      /^Run 1 at \d+:\d{2}$/.test(fromMap.st.rows[0].at) && JSON.stringify(fromMap.st.foot) === '["Open in Steps"]' &&
      await page.evaluate(() => document.getElementById("session-map-dfg-host").getBoundingClientRect().width > 300)),
    JSON.stringify(map.err || fromMap));

  // (c2) A timeline step band (the Steps lane is on by default).
  let fromBand = {};
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await page.waitForSelector('#timeline .tl-step-band[data-step-id="' + OPEN.step_id + '"]', { timeout: T });
    fromBand.laneOn = await page.evaluate(() => document.querySelector('#lanes-popup input[data-lane="steps"]').checked);
    await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })), OPEN.step_id);
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, OPEN.name, { timeout: T });
    fromBand.st = await panelState(page);
    await page.locator("#sp-body .sp-occ.focus .sp-play").click({ timeout: T });
    Object.assign(fromBand, await played(OPEN));
  } catch (e) { fromBand.err = errText(e); }
  record("(c2) V2 items 4 and 8: the Steps lane is on by default, and a click on its band opens the panel on that step and plays it",
    !!(!fromBand.err && fromBand.laneOn && fromBand.ok && fromBand.st.rows.some((r) => r.focus && r.id === OPEN.step_id)),
    JSON.stringify(fromBand));

  // (c3) A Steps row, and Watch in the step pane.
  let fromRow = {};
  try {
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    await page.locator('#step-list .step-row[data-step-id="' + SEARCH.step_id + '"]').click({ timeout: T });
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, SEARCH.name, { timeout: T });
    fromRow.st = await panelState(page);
    await page.locator("#btn-step-watch").click({ timeout: T });
    Object.assign(fromRow, await played(SEARCH));
    fromRow.level = await page.evaluate(() => require("./state.js").getLevel());
    fromRow.listWidth = await page.evaluate(() => Math.round(document.getElementById("step-list").getBoundingClientRect().width));
  } catch (e) { fromRow.err = errText(e); }
  record("(c3) V2 item 4: a selected Steps row opens the panel beside the list (Show on timeline), and Watch in the step pane plays the step there without leaving Steps",
    !!(!fromRow.err && fromRow.ok && fromRow.level === "steps" && fromRow.listWidth > 250 &&
      JSON.stringify(fromRow.st.foot) === '["Show on timeline"]'), JSON.stringify(fromRow));

  // (d) Closed on Steps, the panel stays closed while rows are selected.
  let closed = {};
  try {
    await page.locator("#btn-sp-close").click({ timeout: T });
    await page.locator('#step-list .step-row[data-step-id="' + OPEN.step_id + '"]').click({ timeout: T });
    await wait(400);
    closed.afterRow = (await panelState(page)).shown;
    await page.locator("#btn-step-watch").click({ timeout: T });
    await wait(400);
    closed.afterWatch = (await panelState(page)).shown;
  } catch (e) { closed.err = errText(e); }
  record("(d) the panel's close is its inverse: closed on Steps it stays closed while rows are selected, and Watch opens it again",
    !closed.err && closed.afterRow === false && closed.afterWatch === true, JSON.stringify(closed));
  await page.screenshot({ path: path.join(__dirname, "panel-smoke-steps.png") }).catch(() => {});
  await v.close();

  // (e) The folder moved, opened on a fresh profile.
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-panel-moved-"));
  temps.push(moved);
  fs.cpSync(S, moved, { recursive: true });
  fs.rmSync(S, { recursive: true, force: true });
  let travel = {};
  try {
    ({ v, page } = await open(moved, errs));
    travel.relative = await page.evaluate(() => { const s = require("./state.js").getSession(); return { ok: s.recordingAvailable, path: s.recordingPath }; });
    await v.close();
    // An absolute path from the analyst's computer, the file put in the folder.
    const a = readJson(path.join(moved, "annotations.json"));
    a.external_video.path = "C:\\Users\\pm\\Videos\\" + path.basename(VIDEO);
    fs.writeFileSync(path.join(moved, "annotations.json"), JSON.stringify(a, null, 2));
    fs.renameSync(path.join(moved, "video", path.basename(VIDEO)), path.join(moved, path.basename(VIDEO)));
    ({ v, page } = await open(moved, errs));
    travel.absolute = await page.evaluate(() => { const s = require("./state.js").getSession(); return { ok: s.recordingAvailable, path: s.recordingPath }; });
    await v.close();
  } catch (e) { travel.err = errText(e); }
  const inMoved = (p) => !!p && path.resolve(p).toLowerCase().startsWith(path.resolve(moved).toLowerCase());
  record("(e) V2 item 5: moved and opened on a fresh profile, the recording still has its video (stored relative); an absolute path from another computer falls back to the file of that name in the folder",
    !travel.err && travel.relative.ok && inMoved(travel.relative.path) && travel.absolute.ok &&
      path.resolve(travel.absolute.path) === path.resolve(moved, path.basename(VIDEO)), JSON.stringify(travel));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* temp */ } }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[panel-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[panel-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
