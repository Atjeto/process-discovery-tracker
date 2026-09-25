"use strict";
/*
 * Map e2e smoke: the Map level's one process map (BA-helper cycle; lane MV).
 *
 * Launches the REAL viewer four times on re-normalized TEMP copies of the
 * demo and asserts:
 *   (m1) lane MV: the Map opens on the map the PDD prints,
 *       process_map_step.bpmn drawn by bpmn-js (the live map hidden), under
 *       one header line ("Process map (the PDD prints this map)", "Show how
 *       the transactions ran"), with no participant, lane or frame around
 *       it, and each exclusive gateway with its marker as the editor draws
 *       it; the link shows how the transactions ran and its way back the
 *       map again;
 *   (a) how the transactions ran (the live map, the second view) is ONE
 *       diagram: the Flow diagram built from the runs'
 *       steps, a node per drafted step name (the node rule), time-weighted
 *       edges with no number drawn on them, and only its own controls (fit,
 *       the edit act, Edited maps): no zoom buttons or percentage, no
 *       rare-path slider, no notation tabs, level select, drill scope, file
 *       status line, Advanced views drawer or the product edition's BPMN
 *       view host;
 *   (b) hovering an edge says in words how often the runs took it and its
 *       time (and hides on mouseout);
 *   (c) every path is drawn: the map's edges are the runs' edges, the
 *       exception branch included;
 *   (d) the map follows the steps live: a step taken out of its run's list
 *       (hidden) leaves the map, and comes back with it;
 *   (e) the reference-maps gallery is collapsed until asked for;
 *   (e2) the node rule on a renamed draft: renamed in Steps to a name the
 *       value rules would cut, the step stays ONE node across the runs (its
 *       name), never an extra node of the cut name, and its grouping label is
 *       the name as typed (the pipeline's rule for a drafted step);
 *   (m2) lane MV: the step map is now older than the steps, so showing the
 *       process map again analyzes once (the status line says so), then
 *       draws the renamed step; the Map shown again analyzes nothing;
 *   (m3) Edit, then leaving the editor without a change, keeps nothing: no
 *       reference_maps entry, no file in derived_maps/, annotations.json and
 *       the step map untouched, and the Map shows the same picture;
 *   (m4) Edit with a change keeps the copy (the PDD's As-Is map, its file
 *       carrying the change) and the Map shows it, with its Edit;
 *   (m5) the map editor's own keys: on the kept copy an edit, then Ctrl+Z,
 *       is gone (in the editor and its file), Ctrl+Y brings it back, and the
 *       viewer's own undo does not run underneath (the copy stays,
 *       annotations.json untouched);
 *   (m6) a new copy changed, then the change undone with Ctrl+Z before
 *       leaving, keeps nothing either (its entry and file taken back);
 *   (m7) lane FX2: a step renamed after the As-Is copy was made: the Map's
 *       header says the copy was made before the steps changed, with Copy
 *       again, at once (no analysis first), and the Overview's Checklist
 *       lists Check the As-Is map; Copy again left without a change keeps
 *       nothing, with a change keeps the new copy, which takes the old one's
 *       PDD role (the old one stays, with none) and shows without the line;
 *       Ctrl+Z gives the old copy its role back, Ctrl+Y the new one;
 *   (f) on a marker-STRIPPED copy the map is withheld: the lock message says
 *       why (no runs marked) with the mark-runs instruction, its button lands
 *       on Flow with the Markers panel, and the edit act says why it makes no
 *       copy;
 *   (g) on a copy whose run check failed, the lock says the check could not
 *       run (never "not analyzed yet"), and so does the Overview;
 *   (i) AD-18: a ONE-run copy (the demo cut after its first run) gets its
 *       map and the edit act, with a change, makes its As-Is map for the
 *       PDD; AD-28: the As-Is map is not a stage of the Overview's What is
 *       left line;
 *   (h) zero PAGE ERRORs across the launches.
 *
 * Screenshots land in this dir (gitignored): map-slim-map.png,
 * map-slim-default.png (how the transactions ran), map-slim-edit-unchanged.png,
 * map-slim-edit-changed.png, map-slim-locked.png, map-slim-one-run.png.
 * Re-normalizes into TEMP copies (the committed demo
 * is never regenerated in place) and reuses the viewer's own Electron.
 * Like overview-smoke, a missing deps-bearing Python is a HARD FAIL.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}

function resolvePython() {
  const bundled = path.join(VIEWER, "python", "python.exe");
  if (fs.existsSync(bundled)) return [bundled];
  return ["python", "python3"];
}

/* ONE_RUN_END: the demo's first run ends before it (its End marker at
   09:01:05 is the last event kept), so a copy cut there has one run. */
const ONE_RUN_END = Date.parse("2026-05-14T09:01:05Z");
function makeTempSession({ stripMarkers, oneRun }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-mapslim-e2e-"));
  const srcEvents = fs.readFileSync(path.join(SRC_SESSION, "events.jsonl"), "utf-8");
  let events = srcEvents;
  if (stripMarkers || oneRun) {
    events = srcEvents.split(/\r?\n/).filter((line) => {
      const t = line.trim();
      if (!t) return false;
      let ev;
      try { ev = JSON.parse(t); } catch (_) { return true; }
      if (stripMarkers) return ev.type !== "marker";
      return Date.parse(ev.timestamp) <= ONE_RUN_END;
    }).join("\n") + "\n";
  }
  fs.writeFileSync(path.join(tmp, "events.jsonl"), events);
  fs.copyFileSync(path.join(SRC_SESSION, "manifest.json"), path.join(tmp, "manifest.json"));
  if (!stripMarkers && !oneRun && fs.existsSync(path.join(SRC_SESSION, "annotations.json"))) {
    fs.copyFileSync(path.join(SRC_SESSION, "annotations.json"), path.join(tmp, "annotations.json"));
  }
  return tmp;
}

function normalize(sessionDir) {
  const norm = path.join(REPO, "normalization", "normalize.py");
  let lastErr = null;
  for (const py of resolvePython()) {
    try {
      execFileSync(py, [norm, sessionDir, "--mine"], { cwd: REPO, stdio: "ignore" });
      return true;
    } catch (e) { lastErr = e; }
  }
  console.error("FATAL: could not re-normalize (deps-bearing Python required):",
    lastErr && lastErr.message);
  return false;
}

/* A normalized copy whose run check "failed" the way contract C12 records it:
   case_quality null and one stage_errors entry naming the stage. */
function seedFailedRunCheck(sessionDir) {
  const p = path.join(sessionDir, "analysis.json");
  const a = JSON.parse(fs.readFileSync(p, "utf-8"));
  a.case_quality = null;
  a.stage_errors = (a.stage_errors || []).concat([{ stage: "case_quality", error: "TypeError: seeded by the e2e" }]);
  fs.writeFileSync(p, JSON.stringify(a, null, 2));
}

async function launch(sessionDir, pageErrors) {
  // RP-36: a throwaway profile per launch, never the developer's UI state.
  const { app, close } = await launchViewer(electron, {
    executablePath: electronPath,
    args: [".", "--session=" + sessionDir],
    cwd: VIEWER,
  });
  const page = await app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: 15000 });
  // The window size is launchViewer's (1500x950, or PDT_E2E_WINDOW).
  await wait(1500);
  return { app, page, close };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}

async function openMapLevel(page) {
  const btn = await page.$('.view-mode-btn[data-level="map"]');
  if (btn) { await btn.click().catch(() => {}); await wait(1500); }
}

/* Lane MV: until the Map's own analysis (and any other queued or running)
   has ended. */
async function mapSettled(page) {
  await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
    null, { timeout: 180000 });
}

/* The second view, how the transactions ran (the live map), once the Map
   has settled; the checks that read cytoscape read it there. */
async function showRuns(page) {
  await mapSettled(page);
  const link = page.locator("#btn-map-show-runs");
  if (await link.isVisible()) await link.click({ timeout: 20000 });
  await page.waitForFunction(() => {
    const h = document.getElementById("session-map-dfg-host");
    return !!(h && h.getClientRects().length && (h.__cy || h.querySelector(".map-empty-inline")));
  }, null, { timeout: 20000 });
  await wait(600);
}

/* The Map's picture and its header line as plain data. */
const pictureProbe = () => {
  const $ = (id) => document.getElementById(id);
  const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none";
  const canvas = $("map-asis-canvas");
  const bv = canvas && canvas.__bpmnViewer;
  const reg = bv ? bv.get("elementRegistry") : null;
  const s = require("./state.js").getSession();
  return {
    shown: vis($("session-map-asis")) && !!(canvas && canvas.querySelector(".djs-container > svg")),
    live: vis(document.querySelector("#session-layout-map .map-host")),
    bar: vis($("map-view-bar")),
    title: (($("map-view-title") || {}).textContent || "").trim(),
    note: (($("map-view-note") || {}).textContent || "").trim(),
    toRuns: vis($("btn-map-show-runs")) ? $("btn-map-show-runs").textContent.trim() : null,
    toMap: vis($("btn-map-show-map")) ? $("btn-map-show-map").textContent.trim() : null,
    edit: vis($("btn-map-asis-edit")),
    stale: vis($("map-view-stale")) ? $("map-view-stale").textContent.trim() : null,
    recopy: vis($("btn-map-asis-recopy")) ? $("btn-map-asis-recopy").textContent.trim() : null,
    why: vis($("map-view-why")) ? $("map-view-why").textContent.trim() : null,
    root: bv ? bv.get("canvas").getRootElement().type : null,
    rootId: bv ? bv.get("canvas").getRootElement().id : null,
    names: reg ? reg.filter((e) => e.businessObject && /Task$/.test(e.type)).map((e) => e.businessObject.name || "").sort() : [],
    pools: reg ? reg.filter((e) => /Participant|Lane|Group/.test(e.type)).length : null,
    gateways: reg ? reg.filter((e) => e.type === "bpmn:ExclusiveGateway").map((e) =>
      canvas.querySelectorAll('.djs-element[data-element-id="' + e.id + '"] .djs-visual path').length) : [],
    border: canvas ? ["Top", "Right", "Bottom", "Left"].map((k) => getComputedStyle(canvas)["border" + k + "Width"]) : null,
    outline: canvas ? getComputedStyle(canvas).outlineStyle : null,
    maps: ((s.annotations || {}).reference_maps || []).map((m) => ({ name: m.name, role: m.pdd_role, file: m.file })),
  };
};

/* One change in the map editor (a task renamed), so the new copy is kept;
   then long enough for its delayed write (600 ms). */
async function editorChange(page, name) {
  await page.evaluate((n) => {
    const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
    const task = ed.get("elementRegistry").filter((e) => /Task$/.test(e.type))[0];
    ed.get("modeling").updateLabel(task, n);
  }, name);
  await wait(1400);
}

/* The live map (cytoscape on the host) as plain data: its step boxes (the
   Start and End events, C17, are not steps) and every edge. */
const mapProbe = () => {
  const host = document.getElementById("session-map-dfg-host");
  const cy = host && host.__cy;
  if (!cy) return { drawn: false, text: host ? (host.textContent || "").trim() : null };
  return {
    drawn: true,
    nodes: cy.nodes().filter((n) => n.data("kind") !== "event").map((n) => n.id()).sort(),
    edges: cy.edges().map((e) => ({ label: e.style("label"), freq: e.data("freq"), totalMs: e.data("totalMs") })),
  };
};

/* The lock message the Map shows instead of the map. */
const lockProbe = () => {
  const host = document.getElementById("session-map-dfg-host");
  const empty = host && host.querySelector(".map-empty-inline");
  const zoom = document.getElementById("session-map-zoom");
  const vis = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none";
  return {
    drawn: !!(host && host.__cy),
    text: empty ? (empty.textContent || "").trim() : null,
    cta: !!(empty && empty.querySelector('[data-map-cta="mark-runs"]')),
    zoomHidden: !!(zoom && getComputedStyle(zoom).display === "none"),
    // Lane MV: while the live map says why, no picture and no header line.
    picture: vis(document.getElementById("session-map-asis")),
    bar: vis(document.getElementById("map-view-bar")),
  };
};

(async () => {
  const SESSION_MARKED = makeTempSession({ stripMarkers: false });
  const SESSION_STRIPPED = makeTempSession({ stripMarkers: true });
  const SESSION_FAILED = makeTempSession({ stripMarkers: false });
  const SESSION_ONE_RUN = makeTempSession({ oneRun: true });
  if (!normalize(SESSION_MARKED) || !normalize(SESSION_STRIPPED) || !normalize(SESSION_FAILED) || !normalize(SESSION_ONE_RUN)) {
    record("re-normalize temp sessions (prerequisite)", false, "no deps-bearing Python");
    process.exit(1);
  }
  seedFailedRunCheck(SESSION_FAILED);

  const pageErrors = [];

  // ================= Launch 1: the marked demo (4 runs) ====================
  let page, close;
  try {
    ({ page, close } = await launch(SESSION_MARKED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  await openMapLevel(page);

  // (m1) Lane MV: the Map opens on the map the PDD prints, the step BPMN
  // drawn by bpmn-js, under one header line, with no pool or frame around it.
  const STEP_BPMN = path.join(SESSION_MARKED, "process_map_step.bpmn");
  const m1 = {};
  try {
    await mapSettled(page);
    await page.waitForSelector("#map-asis-canvas .djs-container > svg", { timeout: 30000 });
    await wait(500);
    m1.pic = await page.evaluate(pictureProbe);
    const xml = fs.readFileSync(STEP_BPMN, "utf-8");
    m1.fileProcess = (/<(?:\w+:)?process\s[^>]*\bid="([^"]+)"/.exec(xml) || [])[1] || null;
    m1.fileHasPool = /<(?:\w+:)?(?:participant|collaboration|laneSet)\b/.test(xml);
    await shot(page, "map-slim-map.png");
    await page.locator("#btn-map-show-runs").click({ timeout: 20000 });
    await page.waitForFunction(() => { const h = document.getElementById("session-map-dfg-host"); return !!(h && h.__cy && h.getClientRects().length); }, null, { timeout: 20000 });
    m1.runs = await page.evaluate(pictureProbe);
    await page.locator("#btn-map-show-map").click({ timeout: 20000 });
    await page.waitForSelector("#map-asis-canvas .djs-container > svg", { timeout: 20000 });
    m1.back = await page.evaluate(pictureProbe);
  } catch (e) { m1.err = String(e.message).split("\n")[0]; }
  const p1 = m1.pic || {};
  record("(m1) lane MV: the Map opens on the map the PDD prints (process_map_step.bpmn drawn by bpmn-js, the live map hidden) under one header line, Process map (the PDD prints this map), with Show how the transactions ran",
    !!(!m1.err && p1.shown && !p1.live && p1.bar && p1.title === "Process map" && p1.note === "(the PDD prints this map)" &&
      p1.toRuns === "Show how the transactions ran" && !p1.toMap && !p1.edit && !p1.why && p1.rootId === m1.fileProcess && p1.names.length >= 7),
    JSON.stringify({ err: m1.err, pic: m1.pic && Object.assign({}, p1, { names: p1.names.length }), fileProcess: m1.fileProcess }));
  record("(m1) lane MV: no participant, lane or frame around the map (the file has none, the canvas root is the process, the canvas has no border or outline); each exclusive gateway shows its marker, as the editor and the PDD draw it",
    !!(!m1.err && !m1.fileHasPool && p1.pools === 0 && p1.root === "bpmn:Process" &&
      Array.isArray(p1.border) && p1.border.every((w) => w === "0px") && p1.outline === "none" &&
      p1.gateways.length >= 1 && p1.gateways.every((n) => n >= 1)),
    JSON.stringify({ err: m1.err, fileHasPool: m1.fileHasPool, pools: p1.pools, root: p1.root, border: p1.border, outline: p1.outline, gateways: p1.gateways }));
  const r1 = m1.runs || {}, b1 = m1.back || {};
  record("(m1) lane MV: Show how the transactions ran shows the live map under its own line (How the transactions ran), and Show the process map brings the map back",
    !!(!m1.err && !r1.shown && r1.live && r1.bar && r1.title === "How the transactions ran" && /how often it was taken/.test(r1.note) &&
      r1.toMap === "Show the process map" && !r1.toRuns && b1.shown && !b1.live && b1.title === "Process map"),
    JSON.stringify({ err: m1.err, runs: { shown: r1.shown, live: r1.live, title: r1.title, note: r1.note, toMap: r1.toMap }, back: { shown: b1.shown, title: b1.title } }));

  // The checks below read the live map: how the transactions ran.
  await showRuns(page);

  // (a) One diagram: the Flow diagram of the runs' steps. The node rule: a
  // drafted step is its own name, so the nodes are exactly the drafted names
  // of the runs' visible steps (the value rules would cut "Salesforce - Order:
  // Save order" down to "Salesforce" and merge different steps into one node).
  const drawnMap = await page.evaluate(mapProbe).catch((e) => ({ err: e.message }));
  const def = await page.evaluate((m) => {
    const s = require("./state.js").getSession();
    const RunsModel = require("./runs-model.js");
    const runs = RunsModel.buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
    const names = [...new Set(runs.flatMap((r) => r.visible).map((st) => st.name.trim()))].sort();
    const drafted = runs.flatMap((r) => r.visible).every((st) => !!st.draft_key);
    return {
      drawn: m.drawn, nodes: m.nodes, names, drafted,
      nodesAreNames: m.drawn && JSON.stringify(m.nodes) === JSON.stringify(names),
      // P2.4: no number is drawn on an arrow (the tooltip carries them).
      noArrowLabels: m.drawn && m.edges.length > 0 && m.edges.every((e) => !String(e.label || "").trim()),
      countsKept: m.drawn && m.edges.every((e) => typeof e.freq === "number" && e.freq >= 1),
      anyTime: m.drawn && m.edges.some((e) => (e.totalMs || 0) > 0),
      removed: document.querySelectorAll("#session-layout-map .panel-tab, #session-map-level, #session-map-scope, " +
        "#process-map-status, #map-expert-drawer, #session-map-bpmn-host, #btn-expert-activity-dfg, " +
        "#btn-expert-activity-bpmn, #btn-expert-percase, #btn-session-map-zoom-out, #btn-session-map-zoom-in, " +
        "#session-map-zoom-pct, #session-rng-rare, #session-hide-rare-wrap").length,
      controls: ["btn-session-map-zoom-fit", "btn-fork-refmap", "btn-toggle-refmaps"].filter((id) => !document.getElementById(id)),
      hosts: document.querySelectorAll("#session-layout-map .map-host .map-pane").length,
    };
  }, drawnMap).catch((e) => ({ err: e.message }));
  record("(a) how the transactions ran is one diagram: the Flow diagram of the runs' steps, a node per drafted step name, time-weighted edges with no number drawn on them",
    !!(def && !def.err && def.drawn && def.drafted && def.nodesAreNames && def.noArrowLabels && def.countsKept && def.anyTime),
    JSON.stringify(def && { nodes: def.nodes, nodesAreNames: def.nodesAreNames, drafted: def.drafted,
      noArrowLabels: def.noArrowLabels, anyTime: def.anyTime, err: def.err }));
  record("(a2) only the map's own controls (fit, the edit act, Edited maps): no zoom buttons or percentage, no rare-path slider, no notation tabs, level select, drill scope, file status line, Advanced views or the product edition's BPMN view host",
    !!(def && !def.err && def.removed === 0 && def.controls.length === 0 && def.hosts === 1),
    JSON.stringify(def && { removed: def.removed, missingControls: def.controls, hosts: def.hosts }));
  if (!(def && def.drawn)) await shot(page, "fail-map-slim-default.png");

  // (b) Edge tooltip keeps the traversal count readable in time mode.
  const tip = await page.evaluate(() => {
    const host = document.getElementById("session-map-dfg-host");
    const cy = host && host.__cy;
    if (!cy || !cy.edges().length) return { ok: false, why: "no edges" };
    cy.edges()[0].emit("mouseover");
    const el = host.querySelector(".dfg-edge-tip");
    const text = el ? (el.textContent || "") : "";
    const visible = el && el.style.display !== "none";
    cy.edges()[0].emit("mouseout");
    const hidden = el && el.style.display === "none";
    return { ok: !!(visible && /^Taken \d+ times?\./.test(text) && /Start of one step to start of the next: /.test(text)), text, hidden };
  }).catch((e) => ({ ok: false, why: e.message }));
  record("(b) the edge tooltip says how often the runs took it and its time, in words (and hides on mouseout)",
    !!(tip && tip.ok && tip.hidden), JSON.stringify(tip));

  await shot(page, "map-slim-default.png");

  // (c) P2.3: every path is drawn. A map of 3 to 5 runs has no rare path to
  // thin: a filter could only hide the exception branches the PDD needs (the
  // demo's run 2 detour to Notepad).
  const paths = await page.evaluate(() => {
    const s = require("./state.js").getSession();
    const runs = require("./runs-model.js").buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
    // Every edge, those of the Start and End events included (C17).
    const L = require("./process-map-levels.js");
    const want = L.flowEdges(L.buildAnnotationDfg(runs.map((r) => r.visible))).length;
    const cy = document.getElementById("session-map-dfg-host").__cy;
    return {
      drawn: cy ? cy.edges().length : null, want,
      detour: !!(cy && cy.nodes().some((n) => /^Notepad/.test(n.id()))),
      slider: !!document.getElementById("session-rng-rare"),
    };
  }).catch((e) => ({ err: e.message }));
  record("(c) every path is drawn: the map's edges are the runs' edges, the exception branch included, and no filter exists",
    !!(paths && !paths.err && paths.want > 0 && paths.drawn === paths.want && paths.detour && !paths.slider),
    JSON.stringify(paths));

  // (d) The map follows the step list live: the one step on "Notepad -
  // Internal mappings.txt" (run 2's detour) taken out of the list (hidden)
  // leaves the map; back in the list, it is back on the map.
  const live = await page.evaluate(async () => {
    const State = require("./state.js");
    const s = State.getSession();
    const target = ((s.annotations || {}).steps || []).filter((st) => /^Notepad/.test(st.name || ""));
    const host = document.getElementById("session-map-dfg-host");
    const has = () => !!(host.__cy && host.__cy.nodes().some((n) => /^Notepad/.test(n.id())));
    const before = has();
    const states = target.map((st) => st.state);
    target.forEach((st) => { st.state = "hidden"; });
    State.emit("steps");
    await new Promise((r) => setTimeout(r, 500));
    const hiddenOff = !has();
    target.forEach((st, i) => { st.state = states[i]; });
    State.emit("steps");
    await new Promise((r) => setTimeout(r, 500));
    return { steps: target.length, before, hiddenOff, back: has() };
  }).catch((e) => ({ err: e.message }));
  record("(d) the map follows the steps live: a hidden step leaves the map and comes back with it",
    !!(live && !live.err && live.steps >= 1 && live.before && live.hiddenOff && live.back), JSON.stringify(live));

  // (d2) Lane CC: a box dragged by hand is kept (per level, on this computer)
  // and Reset layout shows beside fit; Reset layout puts the boxes back where
  // the map lays them out and hides itself. A real mouse drag on the canvas.
  const reset = {};
  try {
    const btnState = () => page.evaluate(() => {
      const b = document.getElementById("btn-session-map-reset-layout");
      const fit = document.getElementById("btn-session-map-zoom-fit");
      return { shown: !!(b && !b.hidden && getComputedStyle(b).display !== "none"), text: b ? b.textContent.trim() : null,
        besideFit: !!(b && fit && b.parentElement === fit.parentElement),
        keys: Object.keys(localStorage).filter((k) => k.startsWith("pdt.dfgLayout.")).length };
    });
    reset.before = await btnState();
    const where = await page.evaluate(() => {
      const host = document.getElementById("session-map-dfg-host");
      const cy = host.__cy;
      const n = cy.nodes().filter((x) => x.data("kind") !== "event")[1];
      const p = n.renderedPosition(), r = host.getBoundingClientRect();
      return { id: n.id(), x: r.left + p.x, y: r.top + p.y, model: Object.assign({}, n.position()) };
    });
    reset.id = where.id;
    await page.mouse.move(where.x, where.y);
    await page.mouse.down();
    await page.mouse.move(where.x + 30, where.y + 40, { steps: 6 });
    await page.mouse.move(where.x + 60, where.y + 80, { steps: 6 });
    await page.mouse.up();
    await wait(300);
    reset.moved = await page.evaluate((w) => {
      const n = document.getElementById("session-map-dfg-host").__cy.getElementById(w.id);
      const p = n.position();
      return Math.abs(p.x - w.model.x) + Math.abs(p.y - w.model.y) > 20;
    }, where);
    reset.dragged = await btnState();
    await shot(page, "cc-reset-layout.png");
    await page.locator("#btn-session-map-reset-layout").click({ timeout: 20000 });
    await wait(500);
    reset.back = await page.evaluate((w) => {
      const n = document.getElementById("session-map-dfg-host").__cy.getElementById(w.id);
      const p = n.position();
      return Math.abs(p.x - w.model.x) + Math.abs(p.y - w.model.y) < 2;
    }, where);
    reset.after = await btnState();
  } catch (e) {
    logActionError("(d2) reset layout", e);
    reset.err = String(e.message).split("\n")[0];
    await shot(page, "fail-map-reset-layout.png");
  }
  record("(d2) lane CC: a box dragged on how the transactions ran shows Reset layout beside fit; Reset layout puts the boxes back where the map lays them out and goes (no layout kept)",
    !!(!reset.err && reset.before && !reset.before.shown && reset.moved && reset.dragged.shown && reset.dragged.besideFit &&
      reset.dragged.text === "Reset layout" && reset.dragged.keys >= 1 && reset.back && !reset.after.shown &&
      reset.after.keys === reset.before.keys),
    JSON.stringify(reset));

  // (e) The reference-maps gallery is collapsed until asked for.
  const gallery = await page.evaluate(() => {
    const p = document.getElementById("refmap-panel");
    const t = document.getElementById("btn-toggle-refmaps");
    return { hidden: !!(p && getComputedStyle(p).display === "none"), expanded: t ? t.getAttribute("aria-expanded") : null };
  }).catch((e) => ({ err: e.message }));
  record("(e) the reference-maps gallery is collapsed by default",
    !!(gallery && !gallery.err && gallery.hidden && gallery.expanded === "false"), JSON.stringify(gallery));

  // (e2) The node rule where it matters: a draft renamed in Steps (the step
  // detail form, the analyst's verb) to a name the value rules cut down to
  // "Salesforce". The rename also names the same-key drafts of runs 2 to 4
  // (C4), so all four runs start on the one renamed step: one node, the name.
  const RENAMED = "Salesforce - Account lookup: Look up the customer";
  const renamed = {};
  try {
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: 20000 });
    await page.waitForSelector("#step-list .run-group.open .step-row", { state: "visible", timeout: 20000 });
    await page.locator("#step-list .run-group.open .step-row", { hasText: "Salesforce - Account lookup: Search" })
      .first().click({ timeout: 20000 });
    await page.locator("#step-name").fill(RENAMED, { timeout: 20000 });
    await page.locator("#step-name").press("Enter");   // no Save button: Enter saves the name
    await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")]
      .some((e) => e.textContent.trim() === n), RENAMED, { timeout: 20000 });
    renamed.stamped = await page.evaluate((n) => {
      const st = ((require("./state.js").getSession().annotations || {}).steps || []).filter((x) => x.name === n);
      return st.map((x) => x.state + ":" + x.process_label);
    }, RENAMED);
    await openMapLevel(page);
    renamed.map = await page.evaluate(mapProbe);
    renamed.starts = await page.evaluate(() => {
      const cy = document.getElementById("session-map-dfg-host").__cy;
      return cy ? cy.nodes().filter((n) => n.data("role") === "start").map((n) => n.id()) : null;
    });
  } catch (e) { renamed.err = String(e.message).split("\n")[0]; }
  const rn = renamed.map || {};
  record("(e2) node rule: a draft renamed to a name the value rules would cut stays one node (its name) across the runs, and its grouping label is the name as typed",
    !!(!renamed.err && rn.drawn && rn.nodes.includes(RENAMED) && !rn.nodes.includes("Salesforce") &&
      !rn.nodes.includes("Salesforce - Account lookup: Search") && JSON.stringify(renamed.starts) === JSON.stringify([RENAMED]) &&
      Array.isArray(renamed.stamped) && renamed.stamped.length >= 4 && renamed.stamped.every((x) => x.endsWith(":" + RENAMED))),
    JSON.stringify({ stamped: renamed.stamped, nodes: rn.nodes, starts: renamed.starts, err: renamed.err }));

  // (m2) Lane MV: the rename made the step map older than the steps. The
  // live view needs no analysis; showing the process map again analyzes once
  // (the status line says so), then draws the renamed step.
  const m2 = {};
  try {
    m2.before = { stale: fs.statSync(path.join(SESSION_MARKED, "annotations.json")).mtimeMs > fs.statSync(STEP_BPMN).mtimeMs,
      hasNew: fs.readFileSync(STEP_BPMN, "utf-8").includes(RENAMED) };
    m2.busyOnRuns = await page.evaluate(() => require("./refmap-ui.js").mapBusy());
    await page.evaluate(() => {
      window.__mvPills = [];
      const pills = document.getElementById("session-pills");
      window.__mvObs = new MutationObserver(() => {
        const t = (pills.textContent || "").replace(/\s+/g, " ").trim();
        if (t && window.__mvPills[window.__mvPills.length - 1] !== t) window.__mvPills.push(t);
      });
      window.__mvObs.observe(pills, { childList: true, subtree: true, characterData: true });
    });
    await page.locator("#btn-map-show-map").click({ timeout: 20000 });
    m2.busy = await page.evaluate(() => require("./refmap-ui.js").mapBusy());
    await mapSettled(page);
    await page.waitForFunction((n) => {
      const bv = (document.getElementById("map-asis-canvas") || {}).__bpmnViewer;
      return !!bv && bv.get("elementRegistry").filter((e) => e.businessObject && e.businessObject.name === n).length > 0;
    }, RENAMED, { timeout: 30000 });
    m2.pic = await page.evaluate(pictureProbe);
    m2.pills = await page.evaluate(() => { window.__mvObs.disconnect(); return window.__mvPills; });
    m2.after = { hasNew: fs.readFileSync(STEP_BPMN, "utf-8").includes(RENAMED), mtime: fs.statSync(STEP_BPMN).mtimeMs };
    // Another level and back: nothing to analyze.
    await page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: 20000 });
    await openMapLevel(page);
    m2.again = { busy: await page.evaluate(() => require("./refmap-ui.js").mapBusy()), same: fs.statSync(STEP_BPMN).mtimeMs === m2.after.mtime };
  } catch (e) { m2.err = String(e.message).split("\n")[0]; }
  record("(m2) lane MV: a step map older than the steps is analyzed when the process map shows (once, the status line says so; never for the live view), then the Map draws the renamed step; shown again, nothing is analyzed",
    !!(!m2.err && m2.before.stale && !m2.before.hasNew && m2.busyOnRuns === false && m2.busy === true &&
      m2.pills.some((t) => /^Updating steps and map/.test(t)) && m2.after.hasNew && m2.pic.shown && m2.pic.names.includes(RENAMED) &&
      m2.again.busy === false && m2.again.same),
    JSON.stringify({ err: m2.err, before: m2.before, busyOnRuns: m2.busyOnRuns, busy: m2.busy, pills: m2.pills, after: m2.after && { hasNew: m2.after.hasNew }, drawn: m2.pic && m2.pic.names.includes(RENAMED), again: m2.again }));

  // (m3) Lane MV: Edit, then leaving the editor without a change, keeps
  // nothing, and the Map shows what it showed before.
  const DERIVED = path.join(SESSION_MARKED, "derived_maps");
  const derivedFiles = () => (fs.existsSync(DERIVED) ? fs.readdirSync(DERIVED) : []);
  const m3 = {};
  try {
    await mapSettled(page);
    m3.before = await page.evaluate(pictureProbe);
    m3.annoBefore = fs.readFileSync(path.join(SESSION_MARKED, "annotations.json"), "utf-8");
    m3.bpmnBefore = fs.statSync(STEP_BPMN).mtimeMs;
    await page.locator("#btn-fork-refmap").click({ timeout: 20000 });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(900);
    m3.editorPdd = await page.locator("#refmap-editor-pdd").inputValue({ timeout: 20000 });
    await page.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await wait(1200);
    m3.after = await page.evaluate(pictureProbe);
    m3.inMemory = await page.evaluate(() => ((require("./state.js").getSession().annotations || {}).reference_maps || []).length);
    m3.onDisk = (JSON.parse(fs.readFileSync(path.join(SESSION_MARKED, "annotations.json"), "utf-8")).reference_maps || []).length;
    m3.annoSame = fs.readFileSync(path.join(SESSION_MARKED, "annotations.json"), "utf-8") === m3.annoBefore;
    m3.bpmnSame = fs.statSync(STEP_BPMN).mtimeMs === m3.bpmnBefore;
    m3.files = derivedFiles();
    m3.fork = await page.evaluate(() => (document.getElementById("btn-fork-refmap").textContent || "").trim());
  } catch (e) { m3.err = String(e.message).split("\n")[0]; }
  await shot(page, "map-slim-edit-unchanged.png");
  const same = (a, b) => !!a && !!b && a.shown === b.shown && a.title === b.title && a.rootId === b.rootId && JSON.stringify(a.names) === JSON.stringify(b.names);
  record("(m3) lane MV: Edit, then leaving without a change, keeps nothing (no reference_maps entry in memory or on disk, no file in derived_maps/, annotations.json and the step map untouched), and the Map shows the same picture",
    !!(!m3.err && m3.editorPdd === "as_is" && m3.inMemory === 0 && m3.onDisk === 0 && m3.files.length === 0 && m3.annoSame && m3.bpmnSame &&
      same(m3.before, m3.after) && m3.after.title === "Process map" && !m3.after.edit && m3.fork === "Edit as the As-Is map"),
    JSON.stringify({ err: m3.err, editorPdd: m3.editorPdd, inMemory: m3.inMemory, onDisk: m3.onDisk, files: m3.files, annoSame: m3.annoSame,
      bpmnSame: m3.bpmnSame, before: m3.before && m3.before.title, after: m3.after && m3.after.title, same: same(m3.before, m3.after), fork: m3.fork }));

  // (m4) Lane MV: Edit with a change keeps the copy, and the Map shows it.
  const EDITED = "Look up the customer, edited in the map";
  const m4 = {};
  try {
    await page.locator("#btn-fork-refmap").click({ timeout: 20000 });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(900);
    await editorChange(page, EDITED);
    await page.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await page.waitForFunction((n) => {
      const bv = (document.getElementById("map-asis-canvas") || {}).__bpmnViewer;
      return !!bv && bv.get("elementRegistry").filter((e) => e.businessObject && e.businessObject.name === n).length > 0;
    }, EDITED, { timeout: 30000 });
    await wait(500);
    m4.pic = await page.evaluate(pictureProbe);
    const anno = JSON.parse(fs.readFileSync(path.join(SESSION_MARKED, "annotations.json"), "utf-8"));
    m4.onDisk = (anno.reference_maps || []).map((m) => ({ name: m.name, role: m.pdd_role, file: m.file }));
    m4.files = derivedFiles();
    m4.fileHasEdit = m4.onDisk.length === 1 && fs.readFileSync(path.join(SESSION_MARKED, m4.onDisk[0].file), "utf-8").includes(EDITED);
  } catch (e) { m4.err = String(e.message).split("\n")[0]; }
  await shot(page, "map-slim-edit-changed.png");
  const p4 = m4.pic || {};
  record("(m4) lane MV: Edit with a change keeps the copy (one reference_maps entry, the PDD's As-Is map, its one file in derived_maps/ carrying the change), and the Map shows it: As-Is map (edited; the PDD prints this map), with its Edit",
    !!(!m4.err && JSON.stringify(m4.onDisk.map((m) => [m.name, m.role])) === '[["As-Is map","as_is"]]' && m4.files.length === 1 &&
      m4.onDisk[0].file === "derived_maps/" + m4.files[0] && m4.fileHasEdit &&
      p4.shown && p4.title === "As-Is map" && p4.note === "(edited; the PDD prints this map)" && p4.edit && p4.names.includes(EDITED)),
    JSON.stringify({ err: m4.err, onDisk: m4.onDisk, files: m4.files, fileHasEdit: m4.fileHasEdit, pic: { shown: p4.shown, title: p4.title, note: p4.note, edit: p4.edit } }));

  // (m5) Lane MV: the map editor's own keys. On the kept As-Is copy, an
  // edit, then Ctrl+Z: the edit is gone (in the editor and in its file) and
  // the copy stays (the viewer's own undo does not run underneath).
  const ANNO_MARKED = path.join(SESSION_MARKED, "annotations.json");
  const UNDONE = "An edit undone with Ctrl+Z";
  const inEditor = (n) => page.evaluate((name) => {
    const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
    return ed.get("elementRegistry").filter((e) => e.businessObject && e.businessObject.name === name).length;
  }, n);
  const mapsNow = () => page.evaluate(() => ((require("./state.js").getSession().annotations || {}).reference_maps || [])
    .map((m) => m.name + ":" + (m.pdd_role || "none")));
  const mapsOnDisk = () => (JSON.parse(fs.readFileSync(ANNO_MARKED, "utf-8")).reference_maps || []).map((m) => m.name + ":" + (m.pdd_role || "none"));
  const m5 = {};
  try {
    const copyFile = path.join(SESSION_MARKED, (m4.onDisk && m4.onDisk[0] && m4.onDisk[0].file) || "derived_maps/none.bpmn");
    m5.annoBefore = fs.readFileSync(ANNO_MARKED, "utf-8");
    await page.locator("#btn-map-asis-edit").click({ timeout: 20000 });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 20000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(800);
    await editorChange(page, UNDONE);
    m5.edited = { editor: await inEditor(UNDONE), file: fs.readFileSync(copyFile, "utf-8").includes(UNDONE) };
    await page.keyboard.press("Control+Z");
    await wait(1400);   // the editor writes the undo too, after its delay
    m5.undone = { editor: await inEditor(UNDONE), file: fs.readFileSync(copyFile, "utf-8").includes(UNDONE), back: await inEditor(EDITED) };
    m5.maps = await mapsNow();
    m5.onDisk = mapsOnDisk();
    m5.annoSame = fs.readFileSync(ANNO_MARKED, "utf-8") === m5.annoBefore;
    await page.keyboard.press("Control+Y");
    await wait(300);
    m5.redone = await inEditor(UNDONE);
    await page.keyboard.press("Control+Z");
    await wait(1400);
    await page.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await wait(1000);
    m5.after = await page.evaluate(pictureProbe);
  } catch (e) { m5.err = String(e.message).split("\n")[0]; }
  record("(m5) lane MV: in the map editor, Ctrl+Z undoes the map's own edit (gone in the editor and in the copy's file) and Ctrl+Y redoes it; the viewer's undo does not run underneath: the As-Is copy stays, in memory and on disk, and annotations.json is untouched",
    !!(!m5.err && m5.edited.editor === 1 && m5.edited.file && m5.undone.editor === 0 && !m5.undone.file && m5.undone.back === 1 &&
      m5.redone === 1 && JSON.stringify(m5.maps) === '["As-Is map:as_is"]' && JSON.stringify(m5.onDisk) === '["As-Is map:as_is"]' && m5.annoSame &&
      m5.after.shown && m5.after.title === "As-Is map" && m5.after.names.includes(EDITED) && !m5.after.names.includes(UNDONE)),
    JSON.stringify({ err: m5.err, edited: m5.edited, undone: m5.undone, redone: m5.redone, maps: m5.maps, onDisk: m5.onDisk, annoSame: m5.annoSame,
      after: m5.after && { title: m5.after.title, edited: m5.after.names.includes(EDITED), undone: m5.after.names.includes(UNDONE) } }));

  // (m6) Lane MV: a new copy (Edit a new copy) changed, then the change
  // undone with Ctrl+Z before leaving: nothing is kept either.
  const m6 = {};
  try {
    m6.before = { maps: mapsOnDisk(), files: derivedFiles() };
    m6.label = await page.evaluate(() => (document.getElementById("btn-fork-refmap").textContent || "").trim());
    await page.locator("#btn-fork-refmap").click({ timeout: 20000 });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(800);
    await editorChange(page, "A change taken back");
    m6.whileEdited = await mapsNow();
    await page.keyboard.press("Control+Z");
    await wait(1400);
    await page.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await wait(1500);
    m6.after = { maps: await mapsNow(), onDisk: mapsOnDisk(), files: derivedFiles(), pic: await page.evaluate(pictureProbe) };
  } catch (e) { m6.err = String(e.message).split("\n")[0]; }
  record("(m6) lane MV: a new copy changed, then the change undone with Ctrl+Z before leaving, keeps nothing (its entry and its file taken back); the As-Is copy stays and shows",
    !!(!m6.err && m6.label === "Edit a new copy" && JSON.stringify(m6.whileEdited) === '["As-Is map:as_is","To-Be map:none"]' &&
      JSON.stringify(m6.after.maps) === '["As-Is map:as_is"]' && JSON.stringify(m6.after.onDisk) === '["As-Is map:as_is"]' &&
      JSON.stringify(m6.after.files) === JSON.stringify(m6.before.files) && m6.after.pic.title === "As-Is map"),
    JSON.stringify({ err: m6.err, label: m6.label, before: m6.before, whileEdited: m6.whileEdited,
      after: m6.after && { maps: m6.after.maps, onDisk: m6.after.onDisk, files: m6.after.files, title: m6.after.pic.title } }));

  // (m7) Lane FX2 (validation pass 2, F1 and F12): the As-Is copy made
  // before the steps changed says so where it matters, and Copy again.
  const STALE_TEXT = "Made before the steps changed: check it, or";
  const RENAMED2 = "Enter the order, renamed after the copy";
  const m7 = {};
  try {
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: 20000 });
    await page.waitForSelector("#step-list .run-group.open .step-row", { state: "visible", timeout: 20000 });
    await page.locator("#step-list .run-group.open .step-row", { hasText: "Save order" }).first().click({ timeout: 20000 });
    await page.locator("#step-name").fill(RENAMED2, { timeout: 20000 });
    await page.locator("#step-name").press("Enter");
    await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")]
      .some((e) => e.textContent.trim() === n), RENAMED2, { timeout: 20000 });
    m7.bpmnBefore = fs.statSync(STEP_BPMN).mtimeMs;
    await openMapLevel(page);
    // At once: the header says it before any analysis (the copy shows, so
    // the Map does not analyze).
    m7.header = await page.evaluate(pictureProbe);
    m7.analyzed = fs.statSync(STEP_BPMN).mtimeMs !== m7.bpmnBefore;
    await page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: 20000 });
    await page.waitForSelector("#ov-next", { timeout: 20000 });
    await page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
    m7.checklist = await page.evaluate(() => {
      const li = document.querySelector('#ov-next .ov-next-stage[data-stage="asis"]');
      return { item: li ? li.textContent.trim() : null, done: !!(li && li.classList.contains("done")),
        title: li ? li.title : null, ready: !!document.querySelector("#ov-next.ov-next-ready") };
    });
    await openMapLevel(page);
    await mapSettled(page);
    // Copy again, left without a change: nothing kept.
    m7.filesBefore = derivedFiles();
    await page.locator("#btn-map-asis-recopy").click({ timeout: 20000 });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(900);
    m7.editorName = await page.locator("#refmap-editor-name").inputValue({ timeout: 20000 });
    m7.editorPdd = await page.locator("#refmap-editor-pdd").inputValue({ timeout: 20000 });
    await page.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await wait(1500);
    m7.unchanged = { maps: await mapsNow(), onDisk: mapsOnDisk(), files: derivedFiles() };
    // Copy again, with a change: the new copy is kept and takes the role.
    await page.locator("#btn-map-asis-recopy").click({ timeout: 20000 });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(900);
    await editorChange(page, "Copied again and changed");
    await page.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await page.waitForFunction(() => {
      const bv = (document.getElementById("map-asis-canvas") || {}).__bpmnViewer;
      return !!bv && bv.get("elementRegistry").filter((e) => e.businessObject && e.businessObject.name === "Copied again and changed").length > 0;
    }, null, { timeout: 30000 });
    await wait(500);
    m7.kept = { maps: await mapsNow(), onDisk: mapsOnDisk(), files: derivedFiles(), pic: await page.evaluate(pictureProbe) };
    // Ctrl+Z: the old copy has its role back; Ctrl+Y: the new one again.
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations || {}).reference_maps || []).length === 1, null, { timeout: 20000 });
    m7.undone = { maps: await mapsNow(), onDisk: mapsOnDisk() };
    await page.keyboard.press("Control+y");
    await page.waitForFunction(() => ((require("./state.js").getSession().annotations || {}).reference_maps || []).length === 2, null, { timeout: 20000 });
    m7.redone = { maps: await mapsNow(), onDisk: mapsOnDisk() };
  } catch (e) { m7.err = String(e.message).split("\n")[0]; }
  await shot(page, "map-slim-copy-again.png");
  const h7 = m7.header || {};
  record("(m7) lane FX2: a step renamed after the As-Is copy was made: the header says so at once (no analysis first), with Copy again, and the Overview's Checklist lists Check the As-Is map, not done",
    !!(!m7.err && h7.shown && h7.title === "As-Is map" && h7.stale === STALE_TEXT && h7.recopy === "Copy again" && h7.edit && m7.analyzed === false &&
      m7.checklist && m7.checklist.item === "Check the As-Is map" && !m7.checklist.done && !m7.checklist.ready &&
      /made before the steps changed: check it, or Copy again/.test(m7.checklist.title || "")),
    JSON.stringify({ err: m7.err, header: { title: h7.title, stale: h7.stale, recopy: h7.recopy }, analyzed: m7.analyzed, checklist: m7.checklist }));
  const k7 = m7.kept || {};
  record("(m7) lane FX2: Copy again opens a new copy named like the old one and in its PDD role; left without a change it keeps nothing; with a change it keeps the new copy, which takes the old one's PDD role and shows without the line; Ctrl+Z gives the old copy its role back, Ctrl+Y the new one",
    !!(!m7.err && m7.editorName === "As-Is map" && m7.editorPdd === "as_is" &&
      JSON.stringify(m7.unchanged.maps) === '["As-Is map:as_is"]' && JSON.stringify(m7.unchanged.onDisk) === '["As-Is map:as_is"]' &&
      JSON.stringify(m7.unchanged.files) === JSON.stringify(m7.filesBefore) &&
      JSON.stringify(k7.maps) === '["As-Is map:none","As-Is map:as_is"]' && JSON.stringify(k7.onDisk) === '["As-Is map:none","As-Is map:as_is"]' &&
      k7.files.length === m7.filesBefore.length + 1 && k7.pic && k7.pic.stale === null && k7.pic.recopy === null &&
      k7.pic.names.includes("Copied again and changed") &&
      JSON.stringify(m7.undone.maps) === '["As-Is map:as_is"]' && JSON.stringify(m7.redone.maps) === '["As-Is map:none","As-Is map:as_is"]'),
    JSON.stringify({ err: m7.err, editor: [m7.editorName, m7.editorPdd], unchanged: m7.unchanged, kept: k7 && { maps: k7.maps, onDisk: k7.onDisk, files: (k7.files || []).length,
      stale: k7.pic && k7.pic.stale }, undone: m7.undone, redone: m7.redone }));

  await close();

  // ================= Launch 2: the marker-stripped copy (no runs) ==========
  let page2, close2;
  try {
    ({ page: page2, close: close2 } = await launch(SESSION_STRIPPED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (stripped):", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  await openMapLevel(page2);
  const locked = await page2.evaluate(lockProbe).catch((e) => ({ err: e.message }));
  record("(f) no transactions marked: the map is withheld with the lock message (why + the mark-transactions instruction + its button), and no picture or header line shows",
    !!(locked && !locked.err && !locked.drawn && locked.zoomHidden && !locked.picture && !locked.bar &&
      /^The process map is not shown because it draws how the transactions flow\./.test(locked.text || "") &&
      /This recording has no transactions marked\./.test(locked.text || "") &&
      /right-click where each transaction starts and choose Start a transaction here/i.test(locked.text || "") && locked.cta),
    JSON.stringify(locked));
  if (!(locked && locked.cta)) await shot(page2, "fail-map-slim-locked.png");
  await shot(page2, "map-slim-locked.png");

  // The edit act on a withheld map makes no copy and says why.
  await page2.click("#btn-fork-refmap").catch((e) => console.log("fork", e.message));
  await wait(700);
  const forkLocked = await page2.evaluate(() => ({
    toast: ((document.getElementById("toast") || {}).textContent || "").trim(),
    maps: ((require("./state.js").getSession().annotations || {}).reference_maps || []).length,
    editor: getComputedStyle(document.getElementById("refmap-editor-overlay")).display !== "none",
  })).catch((e) => ({ err: e.message }));
  record("(f2) the edit act on a withheld map makes no copy and says why",
    !!(forkLocked && !forkLocked.err && /^No map to edit yet/.test(forkLocked.toast) && forkLocked.maps === 0 &&
      !forkLocked.editor), JSON.stringify(forkLocked));

  // The lock's call to action lands on Flow with the Markers panel showing.
  await page2.click('#session-map-dfg-host [data-map-cta="mark-runs"]').catch((e) => console.log("cta", e.message));
  await wait(900);
  const ctaLanded = await page2.evaluate(() => {
    const flow = document.getElementById("session-layout-flow");
    const tab = document.querySelector('.anno-tab[data-anno="markers"]');
    const panel = document.querySelector('.anno-panel[data-panel="markers"]');
    return !!(flow && getComputedStyle(flow).display !== "none" &&
      tab && tab.classList.contains("active") &&
      panel && getComputedStyle(panel).display !== "none");
  }).catch(() => false);
  record("(f3) the lock's button lands on Flow with the Markers panel showing",
    !!ctaLanded, ctaLanded ? "" : "Flow + Markers panel did not show");

  await close2();

  // ================= Launch 3: a copy whose run check failed ================
  let page3, close3;
  try {
    ({ page: page3, close: close3 } = await launch(SESSION_FAILED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (failed check):", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const overviewSays = await page3.evaluate(() =>
    ((document.getElementById("ov-summary") || {}).textContent || "").trim()).catch(() => "");
  await openMapLevel(page3);
  const failed = await page3.evaluate(lockProbe).catch((e) => ({ err: e.message }));
  record("(g) a failed run check: the Map says the check could not run (never 'not analyzed yet'), and so does the Overview",
    !!(failed && !failed.err && !failed.drawn &&
      /The transaction check could not run on this recording/.test(failed.text || "") &&
      /Technical detail: TypeError: seeded by the e2e/.test(failed.text || "") &&
      !/not been analyzed/i.test(failed.text || "") &&
      /The transaction check could not run on this recording/.test(overviewSays)),
    JSON.stringify({ map: failed, overview: overviewSays.slice(0, 200) }));
  await close3();

  // ================= Launch 4: a one-run copy (AD-18) ========================
  let page4, close4;
  try {
    ({ page: page4, close: close4 } = await launch(SESSION_ONE_RUN, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (one run):", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const one = {};
  try {
    one.runs = await page4.evaluate(() => ((require("./state.js").getSession().analysis || {}).case_quality || {}).case_count);
    await openMapLevel(page4);
    await mapSettled(page4);
    await page4.waitForSelector("#map-asis-canvas .djs-container > svg", { timeout: 30000 });
    one.picture = await page4.evaluate(pictureProbe);
    await showRuns(page4);
    one.map = await page4.evaluate(lockProbe);
    await page4.locator("#btn-fork-refmap").click({ timeout: 20000 });
    await page4.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page4.waitForSelector("#refmap-editor-host .djs-container", { timeout: 20000 });
    await wait(800);
    // Lane MV: a copy is kept at its first change.
    await editorChange(page4, "Look up the customer");
    one.copy = await page4.evaluate(() => {
      const maps = ((require("./state.js").getSession().annotations || {}).reference_maps || []);
      return maps.map((m) => ({ name: m.name, role: m.pdd_role }));
    });
    await page4.locator("#btn-refmap-editor-close").click({ timeout: 20000 });
    await page4.locator('.view-mode-btn[data-level="overview"]').click({ timeout: 20000 });
    await wait(600);
    one.stages = await page4.evaluate(() => [...document.querySelectorAll("#ov-next .ov-next-stage")].map((e) => e.dataset.stage));
    one.done = await page4.evaluate(() => [...document.querySelectorAll("#ov-next .ov-next-stage.done")].map((e) => e.dataset.stage));
  } catch (e) { one.err = String(e.message).split("\n")[0]; }
  await shot(page4, "map-slim-one-run.png");
  record("(i) AD-18: a one-run recording gets its map (the process map, and how its one transaction ran) and the edit act, with a change, makes its As-Is map for the PDD; AD-28: the line has no As-Is stage",
    !!(!one.err && one.runs === 1 && one.picture && one.picture.shown && one.picture.title === "Process map" &&
      one.map && one.map.drawn && one.map.text === null &&
      JSON.stringify(one.copy) === JSON.stringify([{ name: "As-Is map", role: "as_is" }]) &&
      JSON.stringify(one.stages) === JSON.stringify(["runs", "pattern", "review", "document", "export"]) &&
      Array.isArray(one.done) && one.done.includes("runs")),
    JSON.stringify(one));
  await close4();

  // (h) Zero page errors across the launches.
  record("(h) zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n[e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
