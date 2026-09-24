"use strict";
/*
 * Map e2e smoke: the Map level's one process map (BA-helper cycle).
 *
 * Launches the REAL viewer four times on re-normalized TEMP copies of the
 * demo and asserts:
 *   (a) the Map shows ONE diagram: the Flow diagram built from the runs'
 *       steps, a node per drafted step name (the node rule), time-weighted
 *       edges with no number drawn on them, and only its own controls (fit,
 *       the edit act, Edited maps): no zoom buttons or percentage, no
 *       rare-path slider, no notation tabs, level select, drill scope, file
 *       status line, Advanced views drawer or BPMN view;
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
 *   (f) on a marker-STRIPPED copy the map is withheld: the lock message says
 *       why (no runs marked) with the mark-runs instruction, its button lands
 *       on Flow with the Markers panel, and the edit act says why it makes no
 *       copy;
 *   (g) on a copy whose run check failed, the lock says the check could not
 *       run (never "not analyzed yet"), and so does the Overview;
 *   (i) AD-18: a ONE-run copy (the demo cut after its first run) gets its
 *       map and the edit act makes its As-Is map for the PDD; AD-28: the
 *       As-Is map is not a stage of the Overview's What is left line;
 *   (h) zero PAGE ERRORs across the launches.
 *
 * Screenshots land in this dir (gitignored): map-slim-default.png /
 * map-slim-locked.png. Re-normalizes into TEMP copies (the committed demo
 * is never regenerated in place) and reuses the viewer's own Electron.
 * Like overview-smoke, a missing deps-bearing Python is a HARD FAIL.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const { launchViewer } = require("./throwaway-profile.js");

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

/* The live map (cytoscape on the host) as plain data. */
const mapProbe = () => {
  const host = document.getElementById("session-map-dfg-host");
  const cy = host && host.__cy;
  if (!cy) return { drawn: false, text: host ? (host.textContent || "").trim() : null };
  return {
    drawn: true,
    nodes: cy.nodes().map((n) => n.id()).sort(),
    edges: cy.edges().map((e) => ({ label: e.style("label"), freq: e.data("freq"), totalMs: e.data("totalMs") })),
  };
};

/* The lock message the Map shows instead of the map. */
const lockProbe = () => {
  const host = document.getElementById("session-map-dfg-host");
  const empty = host && host.querySelector(".map-empty-inline");
  const zoom = document.getElementById("session-map-zoom");
  return {
    drawn: !!(host && host.__cy),
    text: empty ? (empty.textContent || "").trim() : null,
    cta: !!(empty && empty.querySelector('[data-map-cta="mark-runs"]')),
    zoomHidden: !!(zoom && getComputedStyle(zoom).display === "none"),
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
  record("(a) the Map shows one diagram: the Flow diagram of the runs' steps, a node per drafted step name, time-weighted edges with no number drawn on them",
    !!(def && !def.err && def.drawn && def.drafted && def.nodesAreNames && def.noArrowLabels && def.countsKept && def.anyTime),
    JSON.stringify(def && { nodes: def.nodes, nodesAreNames: def.nodesAreNames, drafted: def.drafted,
      noArrowLabels: def.noArrowLabels, anyTime: def.anyTime, err: def.err }));
  record("(a2) only the map's own controls (fit, the edit act, Edited maps): no zoom buttons or percentage, no rare-path slider, no notation tabs, level select, drill scope, file status line, Advanced views or BPMN view",
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
    const want = require("./process-map-levels.js").buildAnnotationDfg(runs.map((r) => r.visible)).edges.length;
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
    await page.locator("#btn-step-save").click({ timeout: 20000 });
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
  record("(f) no runs marked: the map is withheld with the lock message (why + the mark-runs instruction + its button)",
    !!(locked && !locked.err && !locked.drawn && locked.zoomHidden &&
      /^The process map is not shown because it draws how the runs flow\./.test(locked.text || "") &&
      /This recording has no runs marked\./.test(locked.text || "") &&
      /start marker at the beginning of each run/i.test(locked.text || "") && locked.cta),
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
      /The run check could not run on this recording/.test(failed.text || "") &&
      /Technical detail: TypeError: seeded by the e2e/.test(failed.text || "") &&
      !/not been analyzed/i.test(failed.text || "") &&
      /The run check could not run on this recording/.test(overviewSays)),
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
    one.map = await page4.evaluate(lockProbe);
    await page4.locator("#btn-fork-refmap").click({ timeout: 20000 });
    await page4.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await wait(800);
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
  record("(i) AD-18: a one-run recording gets its map and the edit act makes its As-Is map for the PDD; AD-28: the line has no As-Is stage",
    !!(!one.err && one.runs === 1 && one.map && one.map.drawn && one.map.text === null &&
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
