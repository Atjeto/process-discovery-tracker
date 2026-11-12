"use strict";
/* C23 (2.0.6): the first video of the chain (external_videos), or the one
   external_video of a project of 2.0.5. */
const firstVideo = (a) => (a && Array.isArray(a.external_videos) && a.external_videos[0]) || (a && a.external_video) || null;
/*
 * Step panel e2e smoke (lane V2 items 3, 4 and 5; step-back review 4.5 and
 * 4.6). Launches the REAL viewer on a throwaway profile against a TEMP copy
 * of the demo, analyzed with the current pipeline, and a synthetic 32 s
 * video recorded in the viewer's own window (a canvas and MediaRecorder,
 * kept in the OS temp folder for the next run). Checks:
 *   (a) Attach video copies the video into the project folder (video/) and
 *       stores its path relative to the folder;
 *   (b) the map boxes name their system under the step name, unless the name names it;
 *   (c) the step panel from each of its doors (a map box, a Steps row with
 *       Play; a timeline step band opens the pane beside the video) opens
 *       with its own video cued to the row it highlights and plays the right
 *       occurrence there, beside the content; plan D2: on Steps it shows only
 *       the video and the rows (nothing the editor shows), standing beside
 *       the editor from 1440 px, and below opening on Play only, in the place
 *       of the step list, the editor keeping its width, Escape giving the
 *       list back and the focus to Play;
 *   (g) the owner's review: one line above the rows says what they are,
 *       built from them, each row reads "Transaction N · m:ss into the
 *       recording · took Ns", a second time in one transaction reads
 *       "Transaction 2, again", and a row's play moves the highlight; lane
 *       FX2: a row whose moment the 32 s video does not cover says so, with
 *       no play, and the panel opened on one hides its video and says why;
 *   (L) the Timeline's lanes show their names at the left, each with a
 *       tooltip, in the order of the work (lane LANES), and the bar of the
 *       whole length's tooltip says what it is;
 *   (d) closed on Steps, it stays closed while rows are selected;
 *   (f) the As-Is map (C18, AD-32), with a note and a file on a step: Export,
 *       Process map (image), with no As-Is copy saves the step BPMN drawn by
 *       bpmn-js; the chosen copy shows drawn by bpmn-js, where a task opens
 *       the panel on its step (and plays it), a file opens its attachment, a
 *       note shows its whole text and a system label takes no click; an edit in
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
const SystemNames = require(path.join(VIEWER, "system-names.js"));
const SRC = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const VIDEO = path.join(os.tmpdir(), "pdt-e2e-synthetic-32s-v1.webm");
const TRACE = path.join(os.tmpdir(), "pdt-panel-trace-" + process.pid + ".log");
const T = 20000;
const SEP = " " + String.fromCharCode(45) + " ";   // a window title's separator

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/* Where the smoke is: a step that waits forever (seen once on the CI runner,
   after the owner's review checks) says which one before run-all stops it. */
let phase = "start";
let lastMove = Date.now();
let live = null;          // { v, page } once the viewer is open
let stalled = false;
const at = (p) => { phase = p; lastMove = Date.now(); };
const within = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error("no answer in " + ms + " ms")), ms))]);
/* What the viewer was doing: its processes' load, and the renderer's
   JavaScript stack (the debugger pauses a page that loops). */
async function diagnose() {
  const info = await within(live.v.app.evaluate(async ({ app, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    app.getAppMetrics();                      // CPU use is measured between two calls
    await new Promise((r) => setTimeout(r, 1000));
    return { crashed: w ? w.webContents.isCrashed() : null,
      cpu: app.getAppMetrics().map((m) => m.type + " " + Math.round(m.cpu.percentCPUUsage) + "%") };
  }), 10000);
  console.log("[panel-e2e] viewer: " + JSON.stringify(info));
  const wins = await within(live.v.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({
    title: w.getTitle(), visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), bounds: w.getBounds(),
    loading: w.webContents.isLoading(), waiting: w.webContents.isWaitingForResponse(), pid: w.webContents.getOSProcessId() }))), 10000);
  console.log("[panel-e2e] windows: " + JSON.stringify(wins));
  if (process.platform === "win32") {
    // The desktop at the stall (CI uploads it) and the windows on it.
    const shot = path.join(process.env.PDT_E2E_STALL_DIR || os.tmpdir(), "pdt-stall-desktop.png");
    const ps = "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; " +
      "$i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); " +
      "$i.Save('" + shot + "'); Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + ': ' + $_.MainWindowTitle }";
    try { console.log("[panel-e2e] desktop windows:" + String.fromCharCode(10) + execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf-8", timeout: 20000 }).trim()); }
    catch (e) { console.log("[panel-e2e] no desktop view: " + String(e.message).split(String.fromCharCode(10))[0]); }
  }
  const cdp = live.cdp;
  if (!cdp) throw new Error("no debugger session");
  const paused = new Promise((r) => cdp.once("Debugger.paused", r));
  await within(cdp.send("Debugger.pause"), 10000);
  const ev = await within(paused, 10000);
  console.log("[panel-e2e] renderer stack:\n" + ev.callFrames.slice(0, 15).map((f) =>
    "    " + (f.functionName || "(anonymous)") + " " + String(f.url).split("/").slice(-2).join("/") + ":" + (f.location.lineNumber + 1)).join("\n"));
}
setInterval(async () => {
  if (stalled || Date.now() - lastMove < 180000) return;
  stalled = true;
  console.log("[panel-e2e] stalled for 3 min at: " + phase);
  try { console.log("[panel-e2e] last calls in the page (when traced):\n" + fs.readFileSync(TRACE, "utf-8").trim().split("\n").slice(-25).map((l) => "    " + l).join("\n")); } catch (_) { /* no trace */ }
  if (live) await diagnose().catch((e) => console.log("[panel-e2e] could not look inside the viewer: " + e.message));
  process.exit(1);
}, 5000).unref();
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  at("after " + name.slice(0, 12));
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

/* Lane FX3: the page's console warnings (cytoscape once printed three on
   every draw of the live map). */
const WARNS = [];

async function open(folder, errs) {
  const v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + folder], cwd: VIEWER });
  const page = await v.app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("console", (m) => { if (m.type() === "warning") WARNS.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
  return { v, page };
}

/* Lane MV: the Map opens on the map the PDD prints and analyzes first when
   the steps are newer than it. showRuns waits for that analysis (and any
   other), then shows how the transactions ran: the live map, whose boxes the
   checks tap. */
async function showRuns(page) {
  await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
    null, { timeout: 180000 });
  const link = page.locator("#btn-map-show-runs");
  if (await link.isVisible()) await link.click({ timeout: T });
  await page.waitForFunction(() => {
    const h = document.getElementById("session-map-dfg-host");
    return !!(h && h.getClientRects().length && h.__cy);
  }, null, { timeout: T });
  await wait(600);
}

/* The panel's state, and where its video is. A row's `at` is what it reads
   ("Transaction 1 · 0:39 into the recording · took 8s"); `focus` and
   `current` say it is the highlighted row, the one the video is at. */
const panelState = (page) => page.evaluate(() => {
  const p = document.getElementById("step-panel");
  const v = document.getElementById("sp-video");
  return {
    shown: !!p && !p.hidden, name: ((document.getElementById("sp-name") || {}).textContent || "").trim(),
    // Lane E-1: on the Timeline and the Map the system is a field (its own
    // value, else the recorded one as its placeholder), then the screen.
    system: (() => {
      const f = document.getElementById("sp-system");
      if (!f) return ((document.querySelector("#sp-about .sp-system") || {}).textContent || "").trim();
      const screen = ((document.querySelector("#sp-fields .sp-screen") || {}).textContent || "").trim();
      return [f.value || f.placeholder, screen].filter(Boolean).join(" · ");
    })(),
    count: ((document.querySelector("#sp-about .sp-count") || {}).textContent || "").trim(),
    explain: ((document.getElementById("sp-explain") || {}).textContent || "").trim(),
    rows: [...document.querySelectorAll("#sp-body .sp-occ")].map((r) => ({ id: r.dataset.stepId,
      at: ((r.querySelector(".sp-at") || {}).textContent || "").trim(), focus: r.classList.contains("focus"),
      current: r.getAttribute("aria-current") === "true", play: !!r.querySelector(".sp-play"),
      nocover: ((r.querySelector(".sp-nocover") || {}).textContent || "").trim(),
      leads: [...r.querySelectorAll(".sp-lead")].map((l) => (l.textContent || "").trim()), shots: r.querySelectorAll(".sp-shot").length })),
    foot: [...document.querySelectorAll("#sp-body .sp-foot button")].map((b) => (b.textContent || "").trim()),
    video: v ? { t: v.currentTime, paused: v.paused, src: !!v.getAttribute("src") } : null,
    videoHidden: v ? v.hidden : null,
    videoNote: (() => { const n = document.getElementById("sp-video-note"); return n && !n.hidden ? (n.textContent || "").trim() : ""; })(),
  };
});

/* Lane E-1: the panel's head: its name field's value (null when the head is
   text), whether the system and description fields are there, and the
   heading (kept for a screen reader, hidden while the field shows). */
const headState = (page) => page.evaluate(() => {
  const n = document.getElementById("sp-name-input");
  const h = document.getElementById("sp-name");
  return { input: n ? n.value : null, system: !!document.getElementById("sp-system"), desc: !!document.getElementById("sp-desc"),
    headingHidden: !!h && h.classList.contains("sr-only"), heading: h ? h.textContent : "",
    aboutSystem: ((document.querySelector("#sp-about .sp-system") || {}).textContent || "").trim(),
    focus: (document.activeElement || {}).id || "" };
});

/* Plan D2: the Steps level's boxes (the list, the editor, the step panel),
   whether the panel stands in the list's place, and the focus. */
const stepsGeo = (page) => page.evaluate(() => {
  const box = (el) => { if (!el || !el.getClientRects().length) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const p = document.getElementById("step-panel");
  return { win: window.innerWidth, list: box(document.getElementById("steps-list-pane")),
    editor: box(document.querySelector("#session-layout-steps .editor-detail-pane")), panel: p.hidden ? null : box(p),
    inList: require("./views/step-panel.js").inList(), focus: (document.activeElement || {}).id || "" };
});

/* Plan D2: what the step panel shows (each counted only when on screen), and
   what the editor beside it shows of the same step. */
const panelParts = (page) => page.evaluate(() => {
  const p = document.getElementById("step-panel");
  const n = (sel) => [...p.querySelectorAll(sel)].filter((e) => e.getClientRects().length).length;
  const ed = document.getElementById("step-detail");
  const step = require("./state.js").getSession().annotations.steps.find((s) => s.step_id === ed.dataset.stepId);
  return { leads: n(".sp-lead"), shots: n(".sp-shot"), said: n(".sp-said"), notes: n(".sp-notes"), system: n(".sp-system, #sp-system"),
    desc: n(".sp-desc, #sp-desc"), flow: n("#sp-flow"), count: n(".sp-count"), waste: n(".sp-waste, .sp-waste-tag"), foot: n(".sp-foot"),
    nameShown: !document.getElementById("sp-name").classList.contains("sr-only"), video: n("#sp-video"), rows: n(".sp-occ"),
    editor: { name: !!ed.querySelector("#step-name"), system: !!ed.querySelector("#step-system"), desc: !!ed.querySelector("#step-desc"),
      flow: !!ed.querySelector(".step-flow"), shots: ed.querySelectorAll(".step-shot-card").length,
      shotsOf: step ? require("./views/analyst-ui.js").shotsOf(step).length : -1 } };
});

/* Lane PANE: the step opened in place in the Timeline's pane (the Steps
   editor's own fields, in #tp-editor), what the pane offers on it, and the
   step panel, which no longer opens on the Timeline. */
const paneState = (page) => page.evaluate(() => {
  const ed = document.getElementById("tp-editor");
  const n = ed && ed.querySelector("#step-name");
  const a = document.activeElement;
  const vd = document.getElementById("video");
  return { open: ed ? ed.dataset.stepId : null, input: n ? n.value : null, readOnly: n ? n.readOnly : null,
    system: !!(ed && ed.querySelector("#step-system")), desc: !!(ed && ed.querySelector("#step-desc")),
    panelHidden: document.getElementById("step-panel").hidden,
    verbs: [...document.querySelectorAll("#tp-steps .tp-verb")].filter((b) => !b.hidden && b.getClientRects().length).map((b) => b.textContent.trim()),
    tools: [...document.querySelectorAll("#tp-steps .tp-tools button, #tp-steps .tp-here, #tp-steps .tp-tx-rename, #tp-steps .tp-tx-delete")].length,
    focus: a ? (a.id || a.className || "") : "", row: a && a.classList && a.classList.contains("tp-row") ? a.dataset.stepId : null,
    video: vd ? { t: vd.currentTime, paused: vd.paused } : null };
});

/* The line above the rows, as the rows shown make it (step-facts.js builds
   it; the unit tests pin its wording): "Transaction N" read from each row,
   the rows with a play, and (lane FX2) the rows the video does not cover. */
const lineFromRows = (st, runCount) => StepFacts.occurrencesLine(st.rows.map((r) => {
  const m = /^Transaction (\d+)/.exec(r.at);
  return { run: m ? { ordinal: Number(m[1]) } : null };
}), runCount, st.rows.filter((r) => r.play).length, st.rows.filter((r) => r.nocover).length);

(async () => {
  const S = freshSession();
  if (!S) { console.log("[panel-e2e] FATAL: no Python with the pipeline dependencies"); process.exit(2); }
  const errs = [];
  const temps = [S, TRACE];
  let { v, page } = await open(S, errs).catch((e) => { console.error("FATAL:", e); process.exit(2); });
  live = { v, page };
  // A debugger session from the start: one opened on a page that already
  // loops gets no answer, one enabled before can pause it.
  try { live.cdp = await page.context().newCDPSession(page); await live.cdp.send("Debugger.enable"); } catch (_) { live.cdp = null; }

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
    attach = firstVideo(readJson(path.join(S, "annotations.json"))) || {};
  } catch (e) { attach.err = errText(e); }
  const copied = path.join(S, "video", path.basename(VIDEO));
  record("(a) Attach video copies the video into the recording folder (video/) and stores its path relative to the folder",
    !attach.err && attach.path === "video/" + path.basename(VIDEO) && fs.existsSync(copied) &&
      fs.statSync(copied).size === fs.statSync(VIDEO).size && Math.abs(attach.offset_ms - 15000) <= 2500,
    JSON.stringify(attach));
  await page.waitForFunction(() => !!require("./state.js").getSession().recordingAvailable, null, { timeout: T }).catch(() => {});
  const offset = (firstVideo(readJson(path.join(S, "annotations.json"))) || {}).offset_ms || 0;
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
  // Lane MV: the boxes of how the transactions ran (the live map).
  let map = {}, fromMap = null;
  try {
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await wait(1500);
    await showRuns(page);
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
    // Lane FX2: the synthetic video's file holds no length; once it is
    // measured, the rows past its end say so.
    await page.waitForSelector("#sp-body .sp-occ .sp-nocover", { timeout: T }).catch(() => {});
    const st = await panelState(page);
    const head = await headState(page);
    await page.locator('#sp-body .sp-occ[data-step-id="' + SAVE.step_id + '"] .sp-play').click({ timeout: T });
    fromMap = Object.assign({ st, cue, head }, await played(SAVE));
    await page.screenshot({ path: path.join(__dirname, "panel-smoke-map-head.png") }).catch(() => {});
    // Plan D2: a box whose step has screenshots: on the Map they sit in its
    // rows, under a Screenshots lead (on Steps they are the editor's).
    await page.evaluate((id) => { document.getElementById("session-map-dfg-host").__cy.getElementById(id).emit("tap"); }, SEARCH.name);
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, SEARCH.name, { timeout: T });
    fromMap.shotRows = (await panelState(page)).rows;
  } catch (e) { map.err = errText(e); }
  // Lane LF-PIPE (#24): a box whose step name already names its system
  // (the demo drafts "Salesforce" and a screen, a colon, the commit) leaves
  // the system line out; the system stays in the box data.
  const boxLabel = (n) => [n.id, SystemNames.systemLine(n.id, n.system)].filter(Boolean).join("\n");
  record("(b) V2 item 3 and lane LF-PIPE: every map box names its system under the step name (Salesforce, SAP, Excel, Outlook, Notepad; never the browser), unless the step name already names it",
    !map.err && map.all.length > 0 && map.all.every((n) => n.system && n.label === boxLabel(n)) &&
      map.all.some((n) => n.label === n.id + "\n" + n.system) && map.all.some((n) => n.label === n.id) &&
      map.save.system === "Salesforce" && !map.all.some((n) => /Chrome/.test(n.system)),
    JSON.stringify(map.err || map.all.map((n) => n.system)));
  record("(c1) V2 item 4 + AD-29: a map box opens the step panel beside the map (its name, system, transactions, one row per occurrence, Open in Steps) and plays the Transaction 1 occurrence in its video; a row's screenshots sit under a Screenshots lead (plan D2: on the Map; on Steps they are the editor's)",
    !!(fromMap && fromMap.ok && fromMap.st.shown && fromMap.st.name === SAVE.name && /^Salesforce/.test(fromMap.st.system) &&
      fromMap.shotRows.some((r) => r.shots > 0) &&
      fromMap.st.rows.concat(fromMap.shotRows).every((r) => (r.shots > 0) === (r.leads[0] === "Screenshots")) &&
      /^In \d of 4 transactions, about \d+s each$/.test(fromMap.st.count) && fromMap.st.rows.length >= 3 &&
      /^Transaction 1 · \d+:\d{2} into the recording · took \d+s$/.test(fromMap.st.rows[0].at) &&
      JSON.stringify(fromMap.st.foot) === '["Open in Steps"]' &&
      await page.evaluate(() => document.getElementById("session-map-dfg-host").getBoundingClientRect().width > 300)),
    JSON.stringify(map.err || fromMap));
  record("(E1-map) lane E-1: on the Map the panel's head is the step's name, system and description as fields (the heading kept for a screen reader)",
    !!(fromMap && fromMap.head && fromMap.head.input === SAVE.name && fromMap.head.system && fromMap.head.desc &&
      fromMap.head.headingHidden && fromMap.head.heading === SAVE.name && fromMap.head.aboutSystem === ""),
    JSON.stringify(map.err || (fromMap && fromMap.head)));
  const mapRows = fromMap ? fromMap.st.rows : [];
  record("(g1) the owner's review + lane FX2: one line above the rows says what they are, built from them (\"This step happened N times: ... Play the one the video covers.\"); each row reads \"Transaction N · m:ss into the recording · took Ns\"; the rows past the 32 s video's end say \"The video does not cover this moment\", with no play; the panel opens with its video paused at the row it highlights (a map box: Transaction 1), not where the video was",
    !!(fromMap && fromMap.cue.ok && /^This step happened .+\. Play the one the video covers\.$/.test(fromMap.st.explain) &&
      fromMap.st.explain === lineFromRows(fromMap.st, 4) && mapRows[0].play && !mapRows[0].nocover && mapRows.length > 1 &&
      mapRows.slice(1).every((r) => !r.play && r.nocover === StepFacts.NOT_COVERED) &&
      mapRows.every((r) => /^Transaction \d(, again)? · \d+:\d{2} into the recording · took \d+s$/.test(r.at)) &&
      mapRows[0].id === SAVE.step_id),
    JSON.stringify(map.err || { explain: fromMap.st.explain, fromRows: lineFromRows(fromMap.st, 4), rows: mapRows.map((r) => [r.at, r.play, r.nocover]), cue: fromMap.cue }));

  // (c4) Lane FX3. With the step panel open beside it, Fit keeps how the
  // transactions ran readable (validation pass 2, item 17; pass 3, F24): never
  // below the zoom where its 11 px text reads about 10 px, its start in view.
  // No cytoscape warning is printed on its draws (item 23). In the dark
  // theme a box flagged as waste has its dashes in the muted text colour, not
  // the faint hairline. The Map's picture (bpmn-js) breaks the names between
  // words, never inside one (F26).
  let c4 = {};
  try {
    await page.locator("#btn-session-map-zoom-fit").click({ timeout: T });
    await wait(400);
    c4.fit = await page.evaluate(() => {
      const host = document.getElementById("session-map-dfg-host");
      const cy = host.__cy, r = host.getBoundingClientRect();
      const start = cy.nodes().filter((x) => x.data("role") === "start-event")[0];
      const p = start ? start.renderedPosition() : null;
      return { zoom: Math.round(cy.zoom() * 1000) / 1000, min: require("./dfg-viewer.js").MIN_READABLE_ZOOM,
        panel: !document.getElementById("step-panel").hidden, hostW: Math.round(r.width),
        startInView: !!p && p.x >= 0 && p.x <= r.width && p.y >= 0 && p.y <= r.height };
    });
    c4.warns = WARNS.filter((w) => /wheel sensitivity|is deprecated for/.test(w));
    c4.waste = await page.evaluate(async (id) => {
      const State = require("./state.js");
      const Theme = require("./theme.js");
      const steps = State.getSession().annotations.steps.filter((x) => x.name === id && x.state !== "hidden");
      const was = steps.map((x) => x.flags);
      Theme.setTheme("dark");
      steps.forEach((x) => { x.flags = Object.assign({}, x.flags || {}, { waste: true }); });
      State.emit("steps");
      await new Promise((r) => setTimeout(r, 900));
      const n = document.getElementById("session-map-dfg-host").__cy.getElementById(id);
      const out = { style: n.style("border-style"), color: n.style("border-color"), fg3: Theme.dfgStyleTokens().fg3 };
      steps.forEach((x, i) => { x.flags = was[i]; });
      Theme.setTheme("light");
      State.emit("steps");
      await new Promise((r) => setTimeout(r, 900));
      return out;
    }, SAVE.name);
    await page.locator("#btn-map-show-map").click({ timeout: T });
    await page.waitForSelector("#map-asis-canvas .djs-container > svg", { timeout: T });
    await wait(1000);
    c4.labels = await page.evaluate(() => {
      const host = document.getElementById("map-asis-canvas");
      const reg = host.__bpmnViewer.get("elementRegistry");
      const out = [];
      for (const el of reg.filter((e) => /^bpmn:(Task|ManualTask|SubProcess)$/.test(e.type))) {
        const name = (el.businessObject.name || "").trim();
        const words = new Set(name.split(/\s+/).filter(Boolean));
        const g = host.querySelector('.djs-element[data-element-id="' + el.id + '"]');
        const lines = g ? [...g.querySelectorAll("text tspan")].map((t) => t.textContent.trim()).filter(Boolean) : [];
        out.push({ name, lines: lines.length, cut: lines.flatMap((l) => l.split(/\s+/)).filter((w) => !words.has(w)) });
      }
      return out;
    });
    await showRuns(page);
  } catch (e) { c4.err = errText(e); }
  const hex = (c) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ""); return m ? "rgb(" + [1, 2, 3].map((i) => parseInt(m[i], 16)).join(",") + ")" : ""; };
  record("(c4) lane FX3: with the step panel open, Fit keeps how the transactions ran readable (zoom at least the readable minimum, its start in view); no cytoscape warning on its draws; a waste box's dashes in the muted text colour in the dark theme; the Map's picture breaks every name between words",
    !c4.err && c4.fit.panel && c4.fit.zoom >= c4.fit.min - 0.001 && c4.fit.startInView && c4.warns.length === 0 &&
      c4.waste.style === "dashed" && c4.waste.color.replace(/\s+/g, "") === hex(c4.waste.fg3) &&
      c4.labels.length > 0 && c4.labels.every((l) => l.lines > 0 && l.cut.length === 0),
    JSON.stringify(c4.err || { fit: c4.fit, warns: c4.warns, waste: c4.waste, cut: c4.labels.filter((l) => l.cut.length) }));

  // (g2) A step done twice in one transaction: va01's Check document (the
  // demo's order is checked again in its second transaction).
  const CHECK = "va01: Check document";
  let twice = {};
  try {
    at("(g2) tap the map box (the evaluate)");
    // The block body returns nothing: returning the tapped collection made
    // Playwright copy cytoscape's whole object graph, which never finished on
    // the CI runner (BH13).
    await page.evaluate((id) => { document.getElementById("session-map-dfg-host").__cy.getElementById(id).emit("tap"); }, CHECK);
    at("(g2) tap the map box (the name shows)");
    await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, CHECK, { timeout: T });
    at("(g2) read the panel");
    twice.st = await panelState(page);
    const first = anno.steps.find((s) => s.step_id === (twice.st.rows[0] || {}).id);
    at("(g2) wait for the video cue");
    twice.cue = first ? await cued(first) : { ok: false, why: "no first row" };
    // Lane FX2 (validation pass 2, F7): the rows after Transaction 1's are
    // past the 32 s video's end: they say so, with no play. Opened on one of
    // them (its Timeline band), the panel hides its video and says why; the
    // play of the row the video covers moves the highlight there, shows the
    // video again and plays it.
    const again = twice.st.rows[2] || {};
    twice.againId = again.id;
    at("(g2) open the panel on a row past the video's end (its row in Steps)");
    // Lane PANE: the panel no longer opens on the Timeline; Steps opens it on
    // its selected row (the arrival Open in Steps makes).
    await page.evaluate((id) => {
      const S = require("./state.js");
      S.consumePendingStepJump();
      S.setSelectedStepId(id);
      S.setPendingStepReveal();
    }, again.id);
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    // Plan D2: below 1440 px the row opens nothing; the editor's Play opens
    // the panel on it (in the place of the step list), and says the video
    // does not cover it.
    twice.narrow = await page.evaluate(() => !require("./views/step-panel.js").standsBeside(window.innerWidth));
    if (twice.narrow) {
      await page.waitForFunction((id) => (document.getElementById("step-detail") || { dataset: {} }).dataset.stepId === id, again.id, { timeout: T });
      await wait(400);
      twice.closedOnRow = await page.evaluate(() => document.getElementById("step-panel").hidden);
      await page.locator("#step-detail #btn-step-watch").click({ timeout: T });
    }
    await page.waitForFunction((id) => !!document.querySelector('#sp-body .sp-occ.focus[data-step-id="' + id + '"]'), again.id, { timeout: T });
    twice.outside = await panelState(page);
    at("(g2) press the covered row's play");
    await page.locator('#sp-body .sp-occ[data-step-id="' + first.step_id + '"] .sp-play').click({ timeout: T });
    const pl = await played(first);
    at("(g2) read the highlight");
    const back = await panelState(page);
    twice.lit = back.rows.filter((r) => r.focus || r.current).map((r) => ({ id: r.id, focus: r.focus, current: r.current }));
    twice.back = { videoHidden: back.videoHidden, note: back.videoNote, played: pl };
  } catch (e) { twice.err = errText(e); }
  const tr = (twice.st && twice.st.rows) || [];
  const out = twice.outside || {};
  record("(g2) the owner's review + lane FX2: a step done twice in one transaction says so: \"This step happened 5 times: once in transactions 1, 3 and 4, twice in transaction 2. Play the one the video covers.\", its second row there reads \"Transaction 2, again\"; the video opens at Transaction 1's row; the rows past the video's end say so, with no play; opened on one of them (its row in Steps; plan D2: below 1440 px the row opens nothing and Play on its line of facts opens it) the panel hides its video and says why; Transaction 1's play moves the highlight there, shows the video and plays it",
    !!(!twice.err && twice.st.explain === "This step happened 5 times: once in transactions 1, 3 and 4, twice in transaction 2. Play the one the video covers." &&
      JSON.stringify(tr.map((r) => r.at.split(" · ")[0])) === JSON.stringify(["Transaction 1", "Transaction 2", "Transaction 2, again", "Transaction 3", "Transaction 4"]) &&
      tr[0].play && !tr[0].nocover && tr.slice(1).every((r) => !r.play && r.nocover === StepFacts.NOT_COVERED) && twice.cue.ok &&
      out.videoHidden === true && out.videoNote === StepFacts.NOT_COVERED + "." &&
      (out.rows || []).some((r) => r.id === twice.againId && r.focus && !r.play && r.nocover === StepFacts.NOT_COVERED) &&
      twice.lit.length === 1 && twice.lit[0].id === tr[0].id && twice.lit[0].focus && twice.lit[0].current &&
      twice.back.videoHidden === false && twice.back.note === "" && twice.back.played.ok && (!twice.narrow || twice.closedOnRow === true)),
    JSON.stringify(twice.err ? twice : { explain: twice.st.explain, rows: tr.map((r) => [r.at, r.play, r.nocover]), cue: twice.cue,
      outside: { hidden: out.videoHidden, note: out.videoNote }, lit: twice.lit, back: twice.back }));

  // (c2) A timeline step band (the Steps lane is on by default).
  let fromBand = {};
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await page.waitForSelector('#timeline .tl-step-band[data-step-id="' + OPEN.step_id + '"]', { timeout: T });
    fromBand.laneOn = await page.evaluate(() => document.querySelector('#lanes-popup input[data-lane="steps"]').checked);
    await page.evaluate(() => { const vd = document.getElementById("video"); if (vd && !vd.paused) vd.pause(); });
    await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })), OPEN.step_id);
    await page.waitForFunction((id) => (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId === id, OPEN.step_id, { timeout: T });
    const want = expectAt(OPEN);
    fromBand.cued = await page.waitForFunction((w) => { const vd = document.getElementById("video");
      return !!(vd && vd.paused && !vd.seeking && Math.abs(vd.currentTime - w) <= 0.3); }, want, { timeout: T }).then(() => true, () => false);
    fromBand.st = await paneState(page);
    fromBand.band = await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]').classList.contains("tl-step-selected"), OPEN.step_id);
  } catch (e) { fromBand.err = errText(e); }
  record("(c2) V2 items 4 and 8, lane PANE: the Steps lane is on by default, and a click on its band opens that step in place in the pane beside the video (its band outlined, the step panel closed: the timeline keeps its width), the video at its start and still paused",
    !!(!fromBand.err && fromBand.laneOn && fromBand.cued && fromBand.st.open === OPEN.step_id && fromBand.st.input === OPEN.name &&
      fromBand.st.panelHidden && fromBand.band && fromBand.st.video.paused),
    JSON.stringify(fromBand));

  // (E1-timeline) Lane E-1, lane PANE: on the Timeline the step opened in
  // the pane edits the step it is on (the Steps editor's fields): keys typed
  // there stay in the field (S adds no step), Escape puts the name back,
  // leaves and goes back to the list (the focus on the step's row), Enter
  // saves a rename and leaves (the band shows it), and Ctrl+Z takes it back.
  let head = {};
  const openBand = async () => {
    await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })), OPEN.step_id);
    await page.waitForFunction((id) => (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId === id, OPEN.step_id, { timeout: T });
  };
  try {
    head.before = await paneState(page);
    const stepsNow = () => page.evaluate(() => (require("./state.js").getSession().annotations.steps || []).length);
    const nameOf = () => page.evaluate((id) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === id) || {}).name, OPEN.step_id);
    head.n0 = await stepsNow();
    await page.locator("#tp-editor #step-name").click({ timeout: T });
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Look up the customer s");
    await wait(400);
    head.typed = { value: await page.locator("#tp-editor #step-name").inputValue(), steps: await stepsNow() };
    await page.keyboard.press("Escape");
    await wait(400);
    head.escaped = Object.assign(await paneState(page), { name: await nameOf() });
    await openBand();
    await page.locator("#tp-editor #step-name").click({ timeout: T });
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Open the customer record");
    await page.keyboard.press("Enter");
    await page.waitForFunction(([id, n]) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === id) || {}).name === n,
      [OPEN.step_id, "Open the customer record"], { timeout: T });
    await wait(500);
    head.renamed = Object.assign(await paneState(page), {
      band: await page.evaluate((id) => { const b = document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]');
        return b ? ((b.textContent || "") + " | " + (b.title || "")) : ""; }, OPEN.step_id) });
    await page.screenshot({ path: path.join(__dirname, "panel-smoke-timeline-head.png") }).catch(() => {});
    await page.keyboard.press("Control+z");
    await page.waitForFunction(([id, n]) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === id) || {}).name === n,
      [OPEN.step_id, OPEN.name], { timeout: T });
    await wait(400);
    head.undone = await paneState(page);
  } catch (e) { head.err = errText(e); }
  record("(E1-timeline) lane E-1, lane PANE: on the Timeline the step opened in the pane has the step's name, system and description as fields (the step panel closed); S typed in the name stays there (no step added), Escape puts the name back, leaves the field and goes back to the list on its row, Enter saves a rename and leaves it (the band shows the new name), and Ctrl+Z takes it back",
    !!(!head.err && head.before.input === OPEN.name && head.before.system && head.before.desc && head.before.panelHidden &&
      head.typed.value === "Look up the customer s" && head.typed.steps === head.n0 &&
      head.escaped.open === null && head.escaped.row === OPEN.step_id && head.escaped.name === OPEN.name &&
      head.renamed.input === "Open the customer record" && head.renamed.focus !== "step-name" && /Open the customer record/.test(head.renamed.band) &&
      head.undone.input === OPEN.name),
    JSON.stringify(head));

  // (L) The owner's reviews: the lanes have a header column, like a video
  // editor's track headers (the second review: "just text labels standing
  // there on the side"): a cell per lane with a key and the lane's name,
  // centred on what the lane draws, in the type of the small section labels
  // (uppercase), with a tooltip saying what it shows; the dividers between
  // the cells run on across the timeline as the lanes' separators; pointing
  // at a cell lights its lane up. Lane LANES: the lanes in the order of the
  // work (Transactions, Steps, Systems, then the media), and the bar of the
  // whole length under them says what it is. The default lanes, then
  // Screenshots turned on (and off again).
  const lanes = {};
  const laneNames = () => page.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const within = (y, sel) => [...document.querySelectorAll(sel)].some((b) => { const r = b.getBoundingClientRect(); return r.height > 0 && y >= r.top && y <= r.bottom; });
    // How far a name's middle is from the middle of its lane's first mark.
    const offset = (n, sel) => { const b = [...document.querySelectorAll(sel)].find((m) => m.getBoundingClientRect().height > 0); return b ? Math.round(Math.abs(mid(n) - mid(b)) * 10) / 10 : null; };
    // C23 (2.0.6): the video attached shows on the Videos lane, under the systems.
    const MARK = { cases: "#timeline .tl-case-band", activity: "#timeline .tl-activity", videos: "#timeline .tl-clip",
      screenshots: "#timeline .tl-screenshot", steps: "#timeline .tl-step-band" };
    const col = document.getElementById("tl-lane-names");
    const tl = document.getElementById("timeline-scroll").getBoundingClientRect();
    // The separators' heights on the page, in the column and across the timeline.
    const ys = (sel) => [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().top)).sort((a, b) => a - b).join();
    return {
      leftOfTimeline: !!col && !col.hidden && col.getBoundingClientRect().right <= tl.left + 1,
      seps: { column: ys("#tl-lane-names .tl-lane-sep"), timeline: ys("#timeline .tl-lane-sep") },
      names: [...document.querySelectorAll("#tl-lane-names .tl-lane-name")].map((n) => {
        const lbl = n.querySelector(".tl-lane-label") || n;
        return { lane: n.dataset.lane, text: (n.textContent || "").trim(), key: !!n.querySelector(".tl-lane-key"),
          title: n.title, inLane: MARK[n.dataset.lane] ? within(mid(lbl), MARK[n.dataset.lane]) : null, whole: lbl.scrollWidth <= lbl.clientWidth,
          off: MARK[n.dataset.lane] ? offset(lbl, MARK[n.dataset.lane]) : null, upper: getComputedStyle(lbl).textTransform === "uppercase" };
      }),
    };
  });
  try {
    lanes.def = await laneNames();
    // The pointer on the Systems header lights the Systems lane up across the
    // timeline, as tall as the cell; off it, nothing is lit.
    const cell = page.locator('#tl-lane-names .tl-lane-name[data-lane="activity"]');
    // Lane SCREEN: the timeline is at the foot of the window, where an
    // earlier act can leave the pointer; a cell drawn again under a pointer
    // that does not move gets no mouseenter, so the pointer leaves first.
    await page.mouse.move(2, 2);
    await cell.hover({ timeout: T });
    lanes.lit = await page.evaluate(() => {
      const c = document.querySelector('#tl-lane-names .tl-lane-name[data-lane="activity"]').getBoundingClientRect();
      const l = [...document.querySelectorAll("#timeline .tl-lane-hover")].map((e) => e.getBoundingClientRect());
      return l.length === 1 && Math.abs(l[0].top - c.top) <= 1 && Math.abs(l[0].height - c.height) <= 1;
    });
    await page.mouse.move(2, 2);
    lanes.unlit = await page.evaluate(() => document.querySelectorAll("#timeline .tl-lane-hover").length === 0);
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.locator('#lanes-popup input[data-lane="screenshots"]').check({ timeout: T });
    await page.waitForSelector("#tl-lane-names .tl-lane-name[data-lane=\"screenshots\"]", { timeout: T });
    lanes.shots = await laneNames();
    await page.locator('#lanes-popup input[data-lane="screenshots"]').uncheck({ timeout: T });
    await page.locator("#btn-lanes").click({ timeout: T });
    await page.locator("#btn-zoom-in").click({ timeout: T });
    lanes.bar = await page.evaluate(() => { const m = document.getElementById("tl-bar"), b = document.getElementById("tl-bar-box");
      return { shown: m.checkVisibility(), part: b.getBoundingClientRect().width < m.getBoundingClientRect().width - 2, title: m.title }; });
    await page.locator("#btn-zoom-reset").click({ timeout: T });
  } catch (e) { lanes.err = errText(e); }
  const said = (list) => (list || []).map((n) => n.text);
  const eachOk = (list) => (list || []).every((n) => n.title.startsWith(n.text + ": ") && n.inLane === true && n.whole &&
    n.off !== null && n.off <= 1.5 && n.upper && n.key);
  const sepsOk = (x) => !!(x && x.seps.column && x.seps.column === x.seps.timeline);
  record("(L) the owner's reviews: the Timeline's lanes have a header column (lane LANES: Transactions, Steps, Systems, Videos; Screenshots once turned on): a cell per lane with its key and its name centred on the lane's marks, in uppercase like the section labels, with a tooltip saying what it shows; the dividers run on across the timeline; pointing at a cell lights its lane; the bar of the whole length's tooltip says what it is, its box the part shown while zoomed in",
    !!(!lanes.err && lanes.def.leftOfTimeline && JSON.stringify(said(lanes.def.names)) === '["Transactions","Steps","Systems","Videos"]' && eachOk(lanes.def.names) &&
      sepsOk(lanes.def) && sepsOk(lanes.shots) && lanes.lit === true && lanes.unlit === true &&
      JSON.stringify(said(lanes.shots.names)) === '["Transactions","Steps","Systems","Videos","Screenshots"]' && eachOk(lanes.shots.names) &&
      lanes.def.names.find((n) => n.lane === "steps").title === "Steps: each step in the order of the process; click one to open it beside the video." &&
      lanes.bar.shown && lanes.bar.part && lanes.bar.title === "The whole length of the timeline: drag the box, or click a place to go there."),
    JSON.stringify(lanes));

  // (c3) A Steps row, and Play on the step editor's line of facts. Plan D2:
  // from 1440 px the panel stands beside the editor and follows the row, its
  // video cued there; below, the row opens nothing (the editor keeps the
  // width it has beside the list) and Play opens the panel in the place of
  // the step list, the focus in it; Escape gives the list back and the focus
  // to Play. Either way the panel shows only the video and the rows: the
  // name, system, description, flow, waste, count, screenshots, what was
  // said, the notes and the foot's acts are the editor's.
  let fromRow = {};
  try {
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    fromRow.wide = await page.evaluate(() => require("./views/step-panel.js").standsBeside(window.innerWidth));
    await page.locator('#step-list .step-row[data-step-id="' + SEARCH.step_id + '"]').click({ timeout: T });
    await page.waitForFunction((id) => (document.getElementById("step-detail") || { dataset: {} }).dataset.stepId === id, SEARCH.step_id, { timeout: T });
    if (fromRow.wide) {
      await page.waitForFunction((n) => (document.getElementById("sp-name") || {}).textContent === n, SEARCH.name, { timeout: T });
      fromRow.cue = await cued(SEARCH);
    } else {
      await wait(600);
    }
    fromRow.onRow = await stepsGeo(page);
    await page.locator("#step-detail #btn-step-watch").click({ timeout: T });
    Object.assign(fromRow, await played(SEARCH));
    fromRow.st = await panelState(page);
    fromRow.head = await headState(page);
    fromRow.parts = await panelParts(page);
    fromRow.onPlay = await stepsGeo(page);
    fromRow.level = await page.evaluate(() => require("./state.js").getLevel());
    await page.screenshot({ path: path.join(__dirname, "panel-smoke-steps.png") }).catch(() => {});
    if (!fromRow.wide) {
      await page.keyboard.press("Escape");
      await wait(400);
      fromRow.onEscape = await stepsGeo(page);
    }
  } catch (e) { fromRow.err = errText(e); }
  const g = fromRow;
  const same = (a, b) => !!(a && b) && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
  const placeOk = g.wide
    // Beside: the list and the editor stay, the panel right of the editor.
    ? !!(g.cue && g.cue.ok && g.onRow.panel && g.onRow.list && g.onRow.panel.x >= g.onRow.editor.x + g.onRow.editor.w &&
      !g.onRow.inList && same(g.onRow.editor, g.onPlay.editor) && g.onPlay.focus === "btn-step-watch")
    // In the list's place: the row opens nothing; Play shows the panel where
    // the list was, the editor not moved, the focus in the panel; Escape
    // gives the list back and the focus to Play.
    : !!(g.onRow && !g.onRow.panel && g.onRow.list && g.onPlay.inList && !g.onPlay.list && same(g.onPlay.panel, g.onRow.list) &&
      same(g.onPlay.editor, g.onRow.editor) && /^(sp-video|btn-sp-close)$/.test(g.onPlay.focus) &&
      g.onEscape && !g.onEscape.panel && same(g.onEscape.list, g.onRow.list) && same(g.onEscape.editor, g.onRow.editor) && g.onEscape.focus === "btn-step-watch");
  record("(c3) V2 item 4, plan D2 (a " + (g.onRow ? g.onRow.win : "?") + " px window): " + (g.wide
    ? "from 1440 px a selected Steps row opens the panel beside the editor, its video cued to that row, and Play plays the step there without leaving Steps"
    : "below 1440 px a selected Steps row opens nothing, the editor keeping its width; Play on its line of facts opens the panel in the place of the step list and plays the step there, the focus in the panel; Escape gives the list back, the editor not moved, the focus back on Play"),
    !!(!g.err && g.ok && g.level === "steps" && placeOk), JSON.stringify(g.err || { wide: g.wide, cue: g.cue, onRow: g.onRow, onPlay: g.onPlay, onEscape: g.onEscape, played: g.ok }));
  const pp = g.parts || {};
  const sr = (g.st && g.st.rows) || [];
  record("(D2-parts) plan D2: on Steps nothing shows twice: the panel shows the video and one row per time the step happened (its transaction, its moment, its play), with no name, system, description, flow, waste, count, screenshot, what was said, note or foot; the editor beside it has the name, the system, the description, the flow and the step's screenshots",
    !!(!g.err && pp.video === 1 && pp.rows >= 2 && pp.rows === sr.length && !pp.nameShown && pp.leads === 0 && pp.shots === 0 && pp.said === 0 &&
      pp.notes === 0 && pp.system === 0 && pp.desc === 0 && pp.flow === 0 && pp.count === 0 && pp.waste === 0 && pp.foot === 0 &&
      JSON.stringify(g.st.foot) === "[]" && sr.every((r) => /^Transaction \d(, again)? · \d+:\d{2} into the recording · took \d+s$/.test(r.at)) &&
      sr.some((r) => r.play) && pp.editor.name && pp.editor.system && pp.editor.desc && pp.editor.flow &&
      pp.editor.shotsOf > 0 && pp.editor.shots === pp.editor.shotsOf),
    JSON.stringify(g.err || { parts: pp, foot: g.st && g.st.foot, rows: sr.map((r) => r.at) }));
  record("(E1-steps) lane E-1, plan D2: on Steps the panel's head has no field and shows no name or system (the editor beside it has them); its heading names the step for a screen reader",
    !!(!g.err && g.head && g.head.input === null && !g.head.system && !g.head.desc &&
      g.head.headingHidden && g.head.heading === SEARCH.name && g.head.aboutSystem === ""),
    JSON.stringify(g.head || g.err));

  // (d) Closed on Steps, the panel stays closed while rows are selected.
  let closed = {};
  try {
    if (!(await panelState(page)).shown) await page.locator("#step-detail #btn-step-watch").click({ timeout: T });
    await page.waitForSelector("#step-panel:not([hidden])", { timeout: T });
    await page.locator("#btn-sp-close").click({ timeout: T });
    await wait(300);
    closed.focusAfterClose = await page.evaluate(() => (document.activeElement || {}).id || "");
    closed.inList = await page.evaluate(() => require("./views/step-panel.js").inList());
    await page.locator('#step-list .step-row[data-step-id="' + OPEN.step_id + '"]').click({ timeout: T });
    await wait(400);
    closed.afterRow = (await panelState(page)).shown;
    await page.locator("#btn-step-watch").click({ timeout: T });
    await wait(400);
    closed.afterWatch = (await panelState(page)).shown;
  } catch (e) { closed.err = errText(e); }
  record("(d) the panel's close is its inverse: closed on Steps it stays closed while rows are selected, and Play opens it again" +
    (fromRow.wide ? "" : "; plan D2: closed from the list's place, the focus goes back to Play"),
    !closed.err && closed.afterRow === false && closed.afterWatch === true && closed.inList === false &&
      (fromRow.wide || closed.focusAfterClose === "btn-step-watch"), JSON.stringify(closed));

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
      labels: /data-element-id="TextAnnotation_system(?:_\d+)?"/.test(svg),
      suggested: path.basename((await v.app.evaluate(() => global.__pdtSaveDefault)) || ""),
      revealed: path.resolve((await v.app.evaluate(() => global.__pdtRevealed)) || ".").toLowerCase() === path.resolve(svgOut).toLowerCase(),
      level: await page.evaluate(() => require("./state.js").getLevel()),
      // Lane FX3: offered under the project's name, then the map's kind.
      base: await page.evaluate(() => {
        const s = require("./state.js").getSession();
        return require("./session-summary.js").exportBaseName(s, require("path").basename(s.sessionFolder));
      }),
    };
  });

  await part("f2", true, async () => {
    // The Map's act makes the As-Is copy (lane MV: kept at its first change,
    // here a system label moved a little); the Map then shows it.
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await page.locator("#btn-fork-refmap").click({ timeout: T });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: T });
    await wait(800);
    await page.evaluate(() => {
      const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
      ed.get("modeling").moveElements([ed.get("elementRegistry").filter((e) => /^TextAnnotation_system/.test(e.id))[0]], { x: 0, y: 8 });
    });
    await wait(1400);   // the editor's delayed write (600 ms)
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
        note: find((e) => is(e, "bpmn:TextAnnotation") && /^TextAnnotation_\d+$/.test(e.id)),
        noteShown: (all.find((e) => is(e, "bpmn:TextAnnotation") && /^TextAnnotation_\d+$/.test(e.id)) || { businessObject: {} }).businessObject.text || "",
        file: find((e) => is(e, "bpmn:DataObjectReference")),
        legend: find((e) => /^TextAnnotation_system/.test(e.id)),
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
    // (f4) A note shows its whole text; a system label takes no click.
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
  record("(f1) C18 + AD-32: Export, Process map (image), with no As-Is copy, saves the step BPMN drawn by bpmn-js (the PDD's picture, its note, file and system labels on it), not the live map, and the level stays",
    !failed.f1 && im.bpmnJs && !im.liveMap && im.note && im.file && im.labels && !!im.base && im.suggested === im.base + " map.svg" && im.revealed && im.level === "steps",
    JSON.stringify(failed.f1 || im));
  const tk = asis.task || {};
  const saveRow = ((tk.st && tk.st.rows) || []).find((r) => r.id === SAVE.step_id) || {};
  record("(f2) C18: with an As-Is copy chosen, the Map shows it drawn by bpmn-js (no picture), and a task opens the panel on its step (Transaction 1 in focus) with the play buttons of the rows its video covers (lane FX2), which play it; the step's note shows in its row under a Notes lead",
    !!(!failed.f2 && asis.view && asis.view.shown && !asis.view.img && asis.view.viewer && asis.view.live === "none" &&
      tk.st && tk.st.shown && tk.st.name === SAVE.name && tk.st.rows.some((r) => r.focus && r.id === SAVE.step_id) &&
      tk.plays >= 1 && tk.plays === tk.st.rows.filter((r) => !r.nocover).length && tk.ok && JSON.stringify(saveRow.leads) === '["Notes"]'),
    JSON.stringify(failed.f2 || { view: asis.view, task: tk }));
  record("(f3) C18: a file on the As-Is map opens its attachment through the safe open path (attachments/ of the project)",
    !failed.f3 && !!asis.opened && path.resolve(asis.opened).toLowerCase() === path.resolve(S, "attachments", ATT.file).toLowerCase(),
    JSON.stringify(failed.f3 || { opened: asis.opened }));
  record("(f4) C18: a note on the As-Is map shows its whole text in a popover (the map shows it cut); a system label takes no click",
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
    firstVideo(a).path = "C:\\Users\\pm\\Videos\\" + path.basename(VIDEO);
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

  // (E1-read-only) Lane E-1: in a hand-off opened read only (here one
  // unzipped by hand: its PDD beside the folder, its version in
  // annotations.json) the step opened in the pane on the Timeline is read,
  // with no act that changes the project (lane PANE).
  let ro = {};
  const roParent = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-panel-ro-"));
  temps.push(roParent);
  try {
    const roProj = path.join(roParent, "Order to cash");
    fs.cpSync(moved, roProj, { recursive: true });
    const a = readJson(path.join(roProj, "annotations.json"));
    a.handoffs = [{ version: 1, handed_off_at: "2026-11-10T09:00:00Z", by: "pm", note: "First version" }];
    fs.writeFileSync(path.join(roProj, "annotations.json"), JSON.stringify(a, null, 2));
    fs.writeFileSync(path.join(roParent, "Order to cash v1 PDD.docx"), "not read");
    ({ v, page } = await open(roProj, errs));
    ro.readOnly = await page.evaluate(() => require("./read-only.js").isReadOnly(require("./state.js").getSession()));
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await page.waitForSelector('#timeline .tl-step-band[data-step-id="' + OPEN.step_id + '"]', { timeout: T });
    await page.evaluate((id) => document.querySelector('#timeline .tl-step-band[data-step-id="' + id + '"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })), OPEN.step_id);
    await page.waitForFunction((id) => (document.getElementById("tp-editor") || { dataset: {} }).dataset.stepId === id, OPEN.step_id, { timeout: T });
    ro.head = await paneState(page);
    ro.adds = await page.evaluate(() => [...document.querySelectorAll("#tp-editor .step-adds button")].filter((b) => b.getClientRects().length).length);
    await page.locator("#tp-steps .tp-back").click({ timeout: T });
    ro.list = await paneState(page);
    await v.close();
  } catch (e) { ro.err = errText(e); try { await v.close(); } catch (_) { /* closed */ } }
  record("(E1-read-only) lane E-1, lane PANE: in a hand-off opened read only the step opened in the pane on the Timeline is read, not typed in (its name read only), with no verb, no add and, back on the list, no act that changes the project; the step panel stays closed",
    !ro.err && ro.readOnly === true && !!ro.head && ro.head.input === OPEN.name && ro.head.readOnly === true && ro.head.panelHidden &&
      ro.head.verbs.length === 0 && ro.adds === 0 && !!ro.list && ro.list.tools === 0, JSON.stringify(ro));

  record("zero PAGE ERRORs", errs.length === 0, errs.slice(0, 5).join(" | "));
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* temp */ } }
  const pass = results.filter((r) => r.ok).length;
  console.log("\n[panel-e2e] " + pass + "/" + results.length + " checks passed, " + (results.length - pass) + " failed");
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("[panel-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
