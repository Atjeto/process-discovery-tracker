"use strict";
/*
 * Step panel e2e smoke (lane V2 items 3, 4 and 5; step-back review 4.5 and
 * 4.6). Launches the REAL viewer on a throwaway profile against a TEMP copy
 * of the demo, analyzed with the current pipeline, and a synthetic 32 s
 * video recorded in the viewer's own window (a canvas and MediaRecorder,
 * kept in the OS temp folder for the next run). Checks:
 *   (a) Attach video copies the video into the project folder (video/) and
 *       stores its path relative to the folder;
 *   (b) the map boxes name their system under the step name;
 *   (c) the step panel from each of its three doors (a map box, a timeline
 *       step band, a Steps row with Watch) opens with its own video cued to
 *       the row it highlights and plays the right occurrence there, beside
 *       the content;
 *   (g) the owner's review: one line above the rows says what they are,
 *       built from them, each row reads "Transaction N · m:ss into the
 *       recording · took Ns", a second time in one transaction reads
 *       "Transaction 2, again", and a row's play moves the highlight;
 *   (L) the Timeline's lanes show their names at the left, each with a
 *       tooltip, and the minimap's tooltip says what it is;
 *   (d) closed on Steps, it stays closed while rows are selected;
 *   (f) the As-Is map (C18, AD-32), with a note and a file on a step: Export,
 *       Process map (image), with no As-Is copy saves the step BPMN drawn by
 *       bpmn-js; the chosen copy shows drawn by bpmn-js, where a task opens
 *       the panel on its step (and plays it), a file opens its attachment, a
 *       note shows its whole text and the legend takes no click; an edit in
 *       the map editor says Saving... then Saved in the top bar, and a task
 *       renamed there says in the panel that no step has its name;
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
const StepFacts = require(path.join(VIEWER, "step-facts.js"));
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

/* The panel's state, and where its video is. A row's `at` is what it reads
   ("Transaction 1 · 0:39 into the recording · took 8s"); `focus` and
   `current` say it is the highlighted row, the one the video is at. */
const panelState = (page) => page.evaluate(() => {
  const p = document.getElementById("step-panel");
  const v = document.getElementById("sp-video");
  return {
    shown: !!p && !p.hidden, name: ((document.getElementById("sp-name") || {}).textContent || "").trim(),
    system: ((document.querySelector("#sp-about .sp-system") || {}).textContent || "").trim(),
    count: ((document.querySelector("#sp-about .sp-count") || {}).textContent || "").trim(),
    explain: ((document.getElementById("sp-explain") || {}).textContent || "").trim(),
    rows: [...document.querySelectorAll("#sp-body .sp-occ")].map((r) => ({ id: r.dataset.stepId,
      at: ((r.querySelector(".sp-at") || {}).textContent || "").trim(), focus: r.classList.contains("focus"),
      current: r.getAttribute("aria-current") === "true", play: !!r.querySelector(".sp-play"),
      leads: [...r.querySelectorAll(".sp-lead")].map((l) => (l.textContent || "").trim()), shots: r.querySelectorAll(".sp-shot").length })),
    foot: [...document.querySelectorAll("#sp-body .sp-foot button")].map((b) => (b.textContent || "").trim()),
    video: v ? { t: v.currentTime, paused: v.paused, src: !!v.getAttribute("src") } : null,
  };
});

/* The line above the rows, as the rows shown make it (step-facts.js builds
   it; the unit tests pin its wording): "Transaction N" read from each row. */
const lineFromRows = (st, runCount) => StepFacts.occurrencesLine(st.rows.map((r) => {
  const m = /^Transaction (\d+)/.exec(r.at);
  return { run: m ? { ordinal: Number(m[1]) } : null };
}), runCount, st.rows.filter((r) => r.play).length);

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
  /* Cue check (the owner's review): the panel opened with its video paused
     at the step's start, not where the video last was, and the step's row is
     the one highlighted. */
  const cued = async (step) => {
    const want = expectAt(step);
    const still = await page.waitForFunction((w) => {
      const v = document.getElementById("sp-video");
      return !!(v && v.paused && !v.seeking && v.readyState >= 1 && Math.abs(v.currentTime - w) <= 0.3);
    }, want, { timeout: T }).then(() => true, () => false);
    const st = await panelState(page);
    const lit = st.rows.filter((r) => r.focus || r.current);
    return { want: Math.round(want * 10) / 10, t: st.video && Math.round(st.video.t * 10) / 10, paused: st.video && st.video.paused,
      lit: lit.map((r) => r.id === step.step_id && r.focus && r.current),
      ok: still && lit.length === 1 && lit[0].id === step.step_id && lit[0].focus && lit[0].current };
  };

  // (b) + (c1) The map: every box names its system; a box opens the panel.
  let map = {}, fromMap = null;
  try {
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await wait(1500);
    map = await page.evaluate((id) => {
      const cy = document.getElementById("session-map-dfg-host").__cy;
      const n = cy.getElementById(id);
      // The step boxes (the Start and End events, C17, are no step).
      const all = cy.nodes().filter((x) => x.data("kind") !== "event")
        .map((x) => ({ id: x.id(), system: x.data("system"), label: x.data("label") }));
      n.emit("tap");
      return { all, save: { system: n.data("system"), label: n.data("label") } };
    }, SAVE.name);
    await page.waitForSelector("#step-panel:not([hidden])", { timeout: T });
    const cue = await cued(SAVE);
    const st = await panelState(page);
    await page.locator('#sp-body .sp-occ[data-step-id="' + SAVE.step_id + '"] .sp-play').click({ timeout: T });
    fromMap = Object.assign({ st, cue }, await played(SAVE));
  } catch (e) { map.err = errText(e); }
  record("(b) V2 item 3: every map box names its system under the step name (Salesforce, SAP, Excel, Outlook, Notepad; never the browser)",
    !map.err && map.all.length > 0 && map.all.every((n) => n.system && n.label === n.id + "\n" + n.system) &&
      map.save.system === "Salesforce" && !map.all.some((n) => /Chrome/.test(n.system)),
    JSON.stringify(map.err || map.all.map((n) => n.system)));
  record("(c1) V2 item 4 + AD-29: a map box opens the step panel beside the map (its name, system, transactions, one row per occurrence, Open in Steps) and plays the Transaction 1 occurrence in its video",
    !!(fromMap && fromMap.ok && fromMap.st.shown && fromMap.st.name === SAVE.name && /^Salesforce/.test(fromMap.st.system) &&
      /^In \d of 4 transactions, about \d+s each$/.test(fromMap.st.count) && fromMap.st.rows.length >= 3 &&
      /^Transaction 1 · \d+:\d{2} into the recording · took \d+s$/.test(fromMap.st.rows[0].at) &&
      JSON.stringify(fromMap.st.foot) === '["Open in Steps"]' &&
      await page.evaluate(() => document.getElementById("session-map-dfg-host").getBoundingClientRect().width > 300)),
    JSON.stringify(map.err || fromMap));
  const mapRows = fromMap ? fromMap.st.rows : [];
  record("(g1) the owner's review: one line above the rows says what they are, built from them (\"This step happened N times: ... Play any of them.\"); each row reads \"Transaction N · m:ss into the recording · took Ns\"; the panel opens with its video paused at the row it highlights (a map box: Transaction 1), not where the video was",
    !!(fromMap && fromMap.cue.ok && /^This step happened .+\. Play any of them\.$/.test(fromMap.st.explain) &&
      fromMap.st.explain === lineFromRows(fromMap.st, 4) && mapRows.every((r) => r.play) &&
      mapRows.every((r) => /^Transaction \d(, again)? · \d+:\d{2} into the recording · took \d+s$/.test(r.at)) &&
      mapRows[0].id === SAVE.step_id),
    JSON.stringify(map.err || { explain: fromMap.st.explain, fromRows: lineFromRows(fromMap.st, 4), rows: mapRows.map((r) => r.at), cue: fromMap.cue }));

  // (g2) A step done twice in one transaction: va01's Check document (the
  // demo's order is checked again in its second transaction).
  const CHECK = "va01: Check document";
  let twice = {};
  try {
    await page.evaluate((id) => document.getElementById("session-map-dfg-host").__cy.getElementById(id).emit("tap"), CHECK);
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, CHECK, { timeout: T });
    twice.st = await panelState(page);
    const first = anno.steps.find((s) => s.step_id === (twice.st.rows[0] || {}).id);
    twice.cue = first ? await cued(first) : { ok: false, why: "no first row" };
    // A row's play moves the highlight to it (its moment is past the 32 s
    // video's end, so only the highlight is checked).
    const again = twice.st.rows[2] || {};
    await page.locator('#sp-body .sp-occ[data-step-id="' + again.id + '"] .sp-play').click({ timeout: T });
    await wait(300);
    twice.lit = (await panelState(page)).rows.filter((r) => r.focus || r.current).map((r) => ({ id: r.id, focus: r.focus, current: r.current }));
    twice.againId = again.id;
  } catch (e) { twice.err = errText(e); }
  const tr = (twice.st && twice.st.rows) || [];
  record("(g2) the owner's review: a step done twice in one transaction says so: \"This step happened 5 times: once in transactions 1, 3 and 4, twice in transaction 2. Play any of them.\", its second row there reads \"Transaction 2, again\"; the video opens at Transaction 1's row, and a row's play moves the highlight to that row",
    !!(!twice.err && twice.st.explain === "This step happened 5 times: once in transactions 1, 3 and 4, twice in transaction 2. Play any of them." &&
      JSON.stringify(tr.map((r) => r.at.split(" · ")[0])) === JSON.stringify(["Transaction 1", "Transaction 2", "Transaction 2, again", "Transaction 3", "Transaction 4"]) &&
      twice.cue.ok && twice.lit.length === 1 && twice.lit[0].id === twice.againId && twice.lit[0].focus && twice.lit[0].current),
    JSON.stringify(twice.err ? twice : { explain: twice.st.explain, rows: tr.map((r) => r.at), cue: twice.cue, lit: twice.lit, again: twice.againId }));

  // (c2) A timeline step band (the Steps lane is on by default).
  let fromBand = {};
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await page.waitForSelector('#timeline .tl-step-band[data-step-id="' + OPEN.step_id + '"]', { timeout: T });
    fromBand.laneOn = await page.evaluate(() => document.querySelector('#lanes-popup input[data-lane="steps"]').checked);
    await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })), OPEN.step_id);
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, OPEN.name, { timeout: T });
    fromBand.cue = await cued(OPEN);
    fromBand.st = await panelState(page);
    await page.locator("#sp-body .sp-occ.focus .sp-play").click({ timeout: T });
    Object.assign(fromBand, await played(OPEN));
  } catch (e) { fromBand.err = errText(e); }
  record("(c2) V2 items 4 and 8: the Steps lane is on by default, and a click on its band opens the panel on that step, its video cued there (the row highlighted), and plays it",
    !!(!fromBand.err && fromBand.laneOn && fromBand.ok && fromBand.cue.ok && fromBand.st.rows.some((r) => r.focus && r.id === OPEN.step_id)),
    JSON.stringify(fromBand));

  // (L) The owner's review: each lane shows its name at the left, in the
  // lane's row, with a tooltip saying what it shows; the minimap says what
  // it is. The default lanes, then Screenshots turned on (and off again).
  const lanes = {};
  const laneNames = () => page.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const within = (y, sel) => [...document.querySelectorAll(sel)].some((b) => { const r = b.getBoundingClientRect(); return r.height > 0 && y >= r.top && y <= r.bottom; });
    const MARK = { cases: "#timeline .tl-case-band", activity: "#timeline .tl-activity", screenshots: "#timeline .tl-screenshot", steps: "#timeline .tl-step-band" };
    const col = document.getElementById("tl-lane-names");
    const tl = document.getElementById("timeline-scroll").getBoundingClientRect();
    return {
      leftOfTimeline: !!col && !col.hidden && col.getBoundingClientRect().right <= tl.left + 1,
      names: [...document.querySelectorAll("#tl-lane-names .tl-lane-name")].map((n) => ({ lane: n.dataset.lane, text: (n.textContent || "").trim(),
        title: n.title, inLane: MARK[n.dataset.lane] ? within(mid(n), MARK[n.dataset.lane]) : null, whole: n.scrollWidth <= n.clientWidth })),
    };
  });
  try {
    lanes.def = await laneNames();
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.locator('#lanes-popup input[data-lane="screenshots"]').check({ timeout: T });
    await page.waitForSelector("#tl-lane-names .tl-lane-name[data-lane=\"screenshots\"]", { timeout: T });
    lanes.shots = await laneNames();
    await page.locator('#lanes-popup input[data-lane="screenshots"]').uncheck({ timeout: T });
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.locator("#btn-zoom-in").click({ timeout: T });
    lanes.minimap = await page.evaluate(() => { const m = document.getElementById("timeline-minimap"); return { shown: getComputedStyle(m).display !== "none", title: m.title }; });
    await page.locator("#btn-zoom-reset").click({ timeout: T });
  } catch (e) { lanes.err = errText(e); }
  const said = (list) => (list || []).map((n) => n.text);
  const eachOk = (list) => (list || []).every((n) => n.title.startsWith(n.text + ": ") && n.inLane === true && n.whole);
  record("(L) the owner's review: the Timeline's lanes show their names at the left (Transactions, Systems, Steps; Screenshots once turned on), each in its lane's row with a tooltip saying what it shows; the minimap's tooltip says it is the whole recording",
    !!(!lanes.err && lanes.def.leftOfTimeline && JSON.stringify(said(lanes.def.names)) === '["Transactions","Systems","Steps"]' && eachOk(lanes.def.names) &&
      JSON.stringify(said(lanes.shots.names)) === '["Transactions","Systems","Screenshots","Steps"]' && eachOk(lanes.shots.names) &&
      lanes.def.names.find((n) => n.lane === "steps").title === "Steps: each step of each transaction; click one to see all its moments." &&
      lanes.minimap.shown && /^The whole recording/.test(lanes.minimap.title)),
    JSON.stringify(lanes));

  // (c3) A Steps row, and Watch in the step pane.
  let fromRow = {};
  try {
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    await page.locator('#step-list .step-row[data-step-id="' + SEARCH.step_id + '"]').click({ timeout: T });
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, SEARCH.name, { timeout: T });
    fromRow.cue = await cued(SEARCH);
    fromRow.st = await panelState(page);
    await page.locator("#btn-step-watch").click({ timeout: T });
    Object.assign(fromRow, await played(SEARCH));
    fromRow.level = await page.evaluate(() => require("./state.js").getLevel());
    fromRow.listWidth = await page.evaluate(() => Math.round(document.getElementById("step-list").getBoundingClientRect().width));
  } catch (e) { fromRow.err = errText(e); }
  const rowShots = ((fromRow.st && fromRow.st.rows) || []);
  record("(c3) V2 item 4: a selected Steps row opens the panel beside the list (Show on timeline), its video cued to that row, and Watch in the step pane plays the step there without leaving Steps; a row's screenshots sit under a Screenshots lead",
    !!(!fromRow.err && fromRow.ok && fromRow.cue.ok && fromRow.level === "steps" && fromRow.listWidth > 250 &&
      JSON.stringify(fromRow.st.foot) === '["Show on timeline"]' && rowShots.some((r) => r.shots > 0) &&
      rowShots.every((r) => (r.shots > 0) === (r.leads[0] === "Screenshots"))), JSON.stringify(fromRow));

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

  // (f) C18 + AD-32: the As-Is map is as linked as the map from the
  // transactions. A note (longer than the map shows) and a file on Save
  // order, as the step pane stores them.
  const NOTE = "Saved only after the credit check passes; a blocked customer goes to the credit team first, never straight to SAP.";
  const ATT = { id: "att-e2e-spec", file: "order-spec.txt", label: "Order spec" };
  const FIRST_NAME = "Check the order in SAP";
  const RENAMED_TASK = "Check the sales order in SAP";
  const asis = {};
  // Each part says its own failure; a part the next ones need stops them.
  const failed = {};
  let blocked = null;
  const part = async (key, needed, fn) => {
    if (blocked) { failed[key] = "not run: " + blocked + " failed"; return; }
    try { await fn(); } catch (e) { failed[key] = errText(e); if (needed) blocked = key; }
  };
  let ids = {};
  await part("f1", false, async () => {
    fs.mkdirSync(path.join(S, "attachments"), { recursive: true });
    fs.writeFileSync(path.join(S, "attachments", ATT.file), "Order spec\n");
    await page.evaluate(async ({ stepId, note, att }) => {
      const s = require("./state.js").getSession();
      const a = s.annotations;
      const now = new Date().toISOString();
      a.analyst_notes = (a.analyst_notes || []).concat([{ id: "note-e2e", text: note, step_id: stepId, at: null, added_at: now }]);
      a.attachments = (a.attachments || []).concat([Object.assign({ step_id: stepId, added_at: now }, att)]);
      await require("./session.js").saveAnnotationsWithUndo(a, "e2e: a note and a file");
    }, { stepId: SAVE.step_id, note: NOTE, att: ATT });

    // (f1) Export, Process map (image), with no As-Is copy: the step BPMN
    // drawn off screen by bpmn-js, the PDD's picture (analyzed first: the
    // note and the file are on it), and the level stays Steps.
    const svgOut = path.join(os.tmpdir(), "pdt-panel-map-" + Date.now() + ".svg");
    await v.app.evaluate(({ dialog, shell }, p) => {
      global.__pdtSaveDefault = null;
      global.__pdtRevealed = null;
      dialog.showSaveDialog = async (_w, opts) => { global.__pdtSaveDefault = (opts && opts.defaultPath) || null; return { canceled: false, filePath: p }; };
      shell.showItemInFolder = (f) => { global.__pdtRevealed = f; };
    }, svgOut);
    await page.locator("#btn-session-export-menu").click({ timeout: T });
    await page.locator("#btn-session-map-svg").click({ timeout: T });
    const by = Date.now() + 120000;
    while (Date.now() < by && !(fs.existsSync(svgOut) && fs.statSync(svgOut).size > 0)) await wait(250);
    await wait(300);
    const svg = fs.existsSync(svgOut) ? fs.readFileSync(svgOut, "utf-8") : "";
    try { fs.unlinkSync(svgOut); } catch (_) { /* not written */ }
    asis.image = {
      bpmnJs: /created with bpmn-js/.test(svg) && /djs-/.test(svg), liveMap: /Process Discovery Tracker: process map/.test(svg),
      note: svg.includes('data-element-id="TextAnnotation_1"'), file: svg.includes('data-element-id="DataObjectReference_' + ATT.id + '"'),
      legend: svg.includes('data-element-id="TextAnnotation_legend"'),
      suggested: path.basename((await v.app.evaluate(() => global.__pdtSaveDefault)) || ""),
      revealed: path.resolve((await v.app.evaluate(() => global.__pdtRevealed)) || ".").toLowerCase() === path.resolve(svgOut).toLowerCase(),
      level: await page.evaluate(() => require("./state.js").getLevel()),
    };
  });

  await part("f2", true, async () => {
    // The Map's act makes the As-Is copy; the Map then shows it.
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await page.locator("#btn-fork-refmap").click({ timeout: T });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await wait(800);
    await page.locator("#btn-refmap-editor-close").click({ timeout: T });
    await page.waitForSelector("#map-asis-canvas .djs-container svg", { timeout: T });
    await wait(500);
    asis.view = await page.evaluate(() => {
      const box = document.getElementById("session-map-asis");
      const host = document.getElementById("map-asis-canvas");
      return { shown: !box.hidden, img: !!box.querySelector("img"), viewer: !!(host && host.__bpmnViewer),
        live: getComputedStyle(document.querySelector("#session-layout-map .map-host")).display };
    });
    ids = await page.evaluate((name) => {
      const all = document.getElementById("map-asis-canvas").__bpmnViewer.get("elementRegistry").filter((e) => e.type !== "label");
      const is = (e, t) => !!(e.businessObject && e.businessObject.$instanceOf(t));
      const find = (f) => { const e = all.find(f); return e ? e.id : null; };
      return {
        task: find((e) => is(e, "bpmn:Task") && e.businessObject.name === name),
        other: find((e) => is(e, "bpmn:Task") && /^va01: Check/.test(e.businessObject.name || "")),
        note: find((e) => is(e, "bpmn:TextAnnotation") && e.id !== "TextAnnotation_legend"),
        noteShown: (all.find((e) => is(e, "bpmn:TextAnnotation") && e.id !== "TextAnnotation_legend") || { businessObject: {} }).businessObject.text || "",
        file: find((e) => is(e, "bpmn:DataObjectReference")),
        legend: find((e) => e.id === "TextAnnotation_legend"),
      };
    }, SAVE.name);

    // (f2) A task opens the panel on its step, with the play buttons.
    await page.click('#map-asis-canvas .djs-element[data-element-id="' + ids.task + '"]', { timeout: T });
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, SAVE.name, { timeout: T });
    asis.task = { st: await panelState(page), plays: await page.locator("#sp-body .sp-occ .sp-play").count() };
    await page.locator("#sp-body .sp-occ.focus .sp-play").click({ timeout: T });
    Object.assign(asis.task, await played(SAVE));
  });

  await part("f3", false, async () => {
    // (f3) A file opens its attachment (the open stubbed in main).
    await v.app.evaluate(({ shell }) => { global.__pdtOpened = null; shell.openPath = async (p) => { global.__pdtOpened = p; return ""; }; });
    await page.click('#map-asis-canvas .djs-element[data-element-id="' + ids.file + '"]', { timeout: T });
    const openBy = Date.now() + 5000;
    while (Date.now() < openBy && !(asis.opened = await v.app.evaluate(() => global.__pdtOpened))) await wait(100);
  });

  await part("f4", false, async () => {
    // (f4) A note shows its whole text; the legend takes no click.
    await page.click('#map-asis-canvas .djs-element[data-element-id="' + ids.note + '"]', { timeout: T });
    asis.note = await page.evaluate(() => ((document.querySelector("#map-asis-note .map-asis-pop-text") || {}).textContent || ""));
    await page.screenshot({ path: path.join(__dirname, "panel-smoke-asis.png") }).catch(() => {});
    const legendAt = await page.evaluate((id) => {
      const r = document.querySelector('#map-asis-canvas .djs-element[data-element-id="' + id + '"]').getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, through: !(hit && hit.closest('[data-element-id="' + id + '"]')) };
    }, ids.legend);
    await page.mouse.click(legendAt.x, legendAt.y);
    await wait(300);
    asis.legend = Object.assign(legendAt, await page.evaluate(() => ({
      pop: !!document.getElementById("map-asis-note"), name: (document.getElementById("sp-name") || {}).textContent })));
  });

  await part("f5", false, async () => {
    // (f5) An edit in the editor says Saving... then Saved in the top bar;
    // another edit with the editor closed at once is written before the Map
    // draws the copy again (it shows it); a task renamed there matches no
    // step: the panel says so.
    await page.locator("#btn-map-asis-edit").click({ timeout: T });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: T });
    await wait(800);
    asis.save = await page.evaluate(async ({ id, name }) => {
      const el = document.getElementById("save-state");
      const seen = [el.dataset.state];
      const mo = new MutationObserver(() => seen.push(el.dataset.state));
      mo.observe(el, { attributes: true, attributeFilter: ["data-state"] });
      const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
      ed.get("modeling").updateLabel(ed.get("elementRegistry").get(id), name);
      await new Promise((r) => setTimeout(r, 1600));
      mo.disconnect();
      return { seen, title: el.title };
    }, { id: ids.other, name: FIRST_NAME });
    const entry = (readJson(path.join(S, "annotations.json")).reference_maps || []).find((m) => m && m.pdd_role === "as_is");
    asis.save.onDisk = !!(entry && fs.readFileSync(path.join(S, entry.file), "utf-8").includes(FIRST_NAME));
    await page.evaluate(({ id, name }) => {
      const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
      ed.get("modeling").updateLabel(ed.get("elementRegistry").get(id), name);
    }, { id: ids.other, name: RENAMED_TASK });
    await page.locator("#btn-refmap-editor-close").click({ timeout: T });
    await page.waitForFunction((n) => {
      const v2 = (document.getElementById("map-asis-canvas") || {}).__bpmnViewer;
      return !!(v2 && v2.get("elementRegistry").filter((e) => e.businessObject && e.businessObject.name === n).length);
    }, RENAMED_TASK, { timeout: T });
    await page.click('#map-asis-canvas .djs-element[data-element-id="' + ids.other + '"]', { timeout: T });
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, RENAMED_TASK, { timeout: T });
    asis.missing = await page.evaluate(() => ({
      about: ((document.getElementById("sp-about") || {}).textContent || "").trim(),
      rows: document.querySelectorAll("#sp-body .sp-occ").length, video: !document.getElementById("sp-video").hidden }));
  });
  const im = asis.image || {};
  record("(f1) C18 + AD-32: Export, Process map (image), with no As-Is copy, saves the step BPMN drawn by bpmn-js (the PDD's picture, its note, file and legend on it), not the live map, and the level stays",
    !failed.f1 && im.bpmnJs && !im.liveMap && im.note && im.file && im.legend && im.suggested === "process-map.svg" && im.revealed && im.level === "steps",
    JSON.stringify(failed.f1 || im));
  const tk = asis.task || {};
  const saveRow = ((tk.st && tk.st.rows) || []).find((r) => r.id === SAVE.step_id) || {};
  record("(f2) C18: with an As-Is copy chosen, the Map shows it drawn by bpmn-js (no picture), and a task opens the panel on its step (Transaction 1 in focus) with its play buttons, which play it; the step's note shows in its row under a Notes lead",
    !!(!failed.f2 && asis.view && asis.view.shown && !asis.view.img && asis.view.viewer && asis.view.live === "none" &&
      tk.st && tk.st.shown && tk.st.name === SAVE.name && tk.st.rows.some((r) => r.focus && r.id === SAVE.step_id) &&
      tk.plays === tk.st.rows.length && tk.ok && JSON.stringify(saveRow.leads) === '["Notes"]'),
    JSON.stringify(failed.f2 || { view: asis.view, task: tk }));
  record("(f3) C18: a file on the As-Is map opens its attachment through the safe open path (attachments/ of the project)",
    !failed.f3 && !!asis.opened && path.resolve(asis.opened).toLowerCase() === path.resolve(S, "attachments", ATT.file).toLowerCase(),
    JSON.stringify(failed.f3 || { opened: asis.opened }));
  record("(f4) C18: a note on the As-Is map shows its whole text in a popover (the map shows it cut); the legend takes no click",
    !failed.f4 && asis.note === NOTE && /…$/.test(ids.noteShown || "") &&
      !!asis.legend && asis.legend.through && !asis.legend.pop && asis.legend.name === SAVE.name,
    JSON.stringify(failed.f4 || { note: asis.note, shown: ids.noteShown, legend: asis.legend }));
  const sv = asis.save || {};
  record("(f5) C18: an edit in the map editor says Saving... then Saved in the top bar and is on disk; an edit closed at once shows on the As-Is map; a task renamed there opens the panel on its name, saying no step has it",
    !!(!failed.f5 && Array.isArray(sv.seen) && sv.seen.includes("saving") && sv.seen[sv.seen.length - 1] === "saved" &&
      /^Saved at /.test(sv.title || "") && sv.onDisk && asis.missing &&
      asis.missing.about === "No step of the transactions has this name." && asis.missing.rows === 0 && !asis.missing.video),
    JSON.stringify(failed.f5 || { save: sv, missing: asis.missing }));
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
