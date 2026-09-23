"use strict";
/*
 * Map-slimming e2e smoke (lab-phase spec §B2/§B5) — the Phase B merge gate.
 *
 * Launches the REAL viewer twice and asserts the slimmed map surface:
 *   (a) the DEFAULT session map is the screen-grain Flow diagram with
 *       TIME-weighted edges (labels read as durations; every edge still
 *       carries the traversal count for the tooltip);
 *   (b) hovering an edge shows the tooltip with the traversal count
 *       (the count stays one hover away in time mode);
 *   (c) on the marked demo (Tier 2 unlocked) the element-grain Process
 *       diagram (observed step BPMN) RENDERS;
 *   (d) the Expert drawer opens and reaches the off-contract activity
 *       cells; the activity level is NOT a visible option of the default
 *       grain select (it left the matrix);
 *   (e) on a marker-STRIPPED re-normalized copy the step BPMN is LOCKED:
 *       the replace-pattern line renders instead (withheld + why + the
 *       mark-runs instruction), and its button opens Flow with the Markers
 *       panel (the same verb as the Overview mark-runs line);
 *   (f) zero PAGE ERRORs across both launches.
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

function makeTempSession({ stripMarkers }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-mapslim-e2e-"));
  const srcEvents = fs.readFileSync(path.join(SRC_SESSION, "events.jsonl"), "utf-8");
  let events = srcEvents;
  if (stripMarkers) {
    events = srcEvents.split(/\r?\n/).filter((line) => {
      const t = line.trim();
      if (!t) return false;
      try { return JSON.parse(t).type !== "marker"; }
      catch (_) { return true; }
    }).join("\n") + "\n";
  }
  fs.writeFileSync(path.join(tmp, "events.jsonl"), events);
  fs.copyFileSync(path.join(SRC_SESSION, "manifest.json"), path.join(tmp, "manifest.json"));
  if (!stripMarkers && fs.existsSync(path.join(SRC_SESSION, "annotations.json"))) {
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

async function launch(sessionDir, pageErrors) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [".", "--session=" + sessionDir],
    cwd: VIEWER,
  });
  const page = await app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1500, 950)).catch(() => {});
  await wait(1500);
  return { app, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}

async function openMapLevel(page) {
  const btn = await page.$('.view-mode-btn[data-level="map"]');
  if (btn) { await btn.click().catch(() => {}); await wait(1500); }
}

(async () => {
  const SESSION_MARKED = makeTempSession({ stripMarkers: false });
  const SESSION_STRIPPED = makeTempSession({ stripMarkers: true });
  if (!normalize(SESSION_MARKED) || !normalize(SESSION_STRIPPED)) {
    record("re-normalize temp sessions (prerequisite)", false, "no deps-bearing Python");
    process.exit(1);
  }

  const pageErrors = [];

  // ================= Launch 1: the marked demo ============================
  let app, page;
  try {
    ({ app, page } = await launch(SESSION_MARKED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  await openMapLevel(page);

  // (a) Default = screen-grain Flow diagram, TIME-weighted edges.
  const def = await page.evaluate(() => {
    const dfgTab = document.querySelector('#session-layout-map .panel-tab[data-map="dfg"]');
    const levelSel = document.getElementById("session-map-level");
    const host = document.getElementById("session-map-dfg-host");
    const cy = host && host.__cy;
    if (!cy) return { rendered: false, dfgTabActive: !!(dfgTab && dfgTab.classList.contains("active")), level: levelSel && levelSel.value };
    const edges = cy.edges().map((e) => ({
      label: e.data("edgeLabel"), freq: e.data("freq"), totalMs: e.data("totalMs"),
    }));
    const durationRe = /^(<1s|\d+s|\d+m( \d{2}s)?|\d+h \d{2}m)$/;
    return {
      rendered: true,
      dfgTabActive: !!(dfgTab && dfgTab.classList.contains("active")),
      level: levelSel ? levelSel.value : null,
      edgeCount: edges.length,
      allDurationLabels: edges.length > 0 && edges.every((e) => durationRe.test(String(e.label || ""))),
      allCarryCount: edges.every((e) => typeof e.freq === "number" && e.freq >= 1),
      anyMeasuredTime: edges.some((e) => (e.totalMs || 0) > 0),
      sampleLabels: edges.slice(0, 4).map((e) => e.label),
    };
  }).catch((e) => ({ err: e.message }));
  record("(a) default map = screen-grain Flow diagram with time-weighted edges",
    !!(def && !def.err && def.rendered && def.dfgTabActive && def.level === "screen" &&
       def.allDurationLabels && def.allCarryCount && def.anyMeasuredTime),
    JSON.stringify(def));
  if (!(def && def.rendered && def.allDurationLabels)) await shot(page, "fail-map-slim-default.png");

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
    return { ok: !!(visible && /× traversed/.test(text)), text, hidden };
  }).catch((e) => ({ ok: false, why: e.message }));
  record("(b) edge tooltip shows the traversal count (and hides on mouseout)",
    !!(tip && tip.ok && tip.hidden), JSON.stringify(tip));

  await shot(page, "map-slim-default.png");

  // (c) Tier 2 unlocked (markers): the element-grain observed step BPMN renders.
  await page.selectOption("#session-map-level", "element").catch(() => {});
  await wait(600);
  await page.click('#session-layout-map .panel-tab[data-map="bpmn"]').catch(() => {});
  await wait(1500);
  const unlocked = await page.evaluate(() => {
    const host = document.getElementById("session-map-bpmn-host");
    return {
      shapes: host ? host.querySelectorAll(".djs-element[data-element-id]").length : 0,
      lockText: host ? /is not shown/i.test(host.textContent || "") : null,
    };
  }).catch((e) => ({ err: e.message }));
  record("(c) marked demo: element-grain Process diagram (step BPMN) renders unlocked",
    !!(unlocked && !unlocked.err && unlocked.shapes > 0 && unlocked.lockText === false),
    JSON.stringify(unlocked));
  if (!(unlocked && unlocked.shapes > 0)) await shot(page, "fail-map-slim-unlocked.png");

  // (d) Expert drawer reaches the off-contract cells; activity left the select.
  const selectSlim = await page.evaluate(() => {
    const sel = document.getElementById("session-map-level");
    const opts = sel ? [...sel.options] : [];
    const activity = opts.find((o) => o.value === "activity");
    return {
      hasActivityOption: !!activity,
      activityHidden: activity ? activity.hidden : null,
      visibleValues: opts.filter((o) => !o.hidden).map((o) => o.value),
    };
  }).catch((e) => ({ err: e.message }));
  record("(d1) activity-taxonomy level is out of the default grain select",
    !!(selectSlim && !selectSlim.err && selectSlim.activityHidden === true &&
       !selectSlim.visibleValues.includes("activity")),
    JSON.stringify(selectSlim));

  const drawer = await page.evaluate(() => {
    const d = document.getElementById("map-expert-drawer");
    if (!d) return { present: false };
    d.open = true;
    return {
      present: true,
      open: d.open,
      cells: ["btn-expert-activity-dfg", "btn-expert-activity-bpmn", "btn-expert-percase"]
        .map((id) => !!document.getElementById(id)),
    };
  }).catch((e) => ({ err: e.message }));
  record("(d2) Expert drawer opens with the three off-contract cells",
    !!(drawer && !drawer.err && drawer.present && drawer.open &&
       drawer.cells.every(Boolean)),
    JSON.stringify(drawer));

  await page.click("#btn-expert-activity-bpmn").catch((e) => console.log("expert cell", e.message));
  await wait(1500);
  const expertBpmn = await page.evaluate(() => {
    const host = document.getElementById("session-map-bpmn-host");
    const sel = document.getElementById("session-map-level");
    return {
      shapes: host ? host.querySelectorAll(".djs-element[data-element-id]").length : 0,
      level: sel ? sel.value : null,
    };
  }).catch((e) => ({ err: e.message }));
  record("(d3) Expert cell renders the inductive activity BPMN (process_map.bpmn)",
    !!(expertBpmn && !expertBpmn.err && expertBpmn.shapes > 0 && expertBpmn.level === "activity"),
    JSON.stringify(expertBpmn));

  await app.close().catch(() => {});

  // ================= Launch 2: the marker-stripped copy ====================
  let app2, page2;
  try {
    ({ app: app2, page: page2 } = await launch(SESSION_STRIPPED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (stripped):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  await openMapLevel(page2);
  // Element grain on the Flow diagram, then EXPLICITLY ask for the Process
  // diagram — the §1 replace-pattern must show (no silent fallback).
  await page2.selectOption("#session-map-level", "element").catch(() => {});
  await wait(600);
  await page2.click('#session-layout-map .panel-tab[data-map="bpmn"]').catch(() => {});
  await wait(1200);
  const locked = await page2.evaluate(() => {
    const host = document.getElementById("session-map-bpmn-host");
    const empty = host && host.querySelector(".map-empty-inline");
    const text = empty ? (empty.textContent || "") : "";
    return {
      hasLockLine: /is not shown/i.test(text) && /draws how cases\s+flow/i.test(text),
      explainsWhy: /no runs marked|cover only|not been analyzed/i.test(text),
      instruction: /start marker at the beginning of each run/i.test(text),
      ctaPresent: !!(empty && empty.querySelector('[data-map-cta="mark-runs"]')),
      shapes: host ? host.querySelectorAll(".djs-element[data-element-id]").length : 0,
      text: text.slice(0, 220),
    };
  }).catch((e) => ({ err: e.message }));
  record("(e) stripped session: step BPMN locked: replace-pattern line + mark-runs instruction, no diagram",
    !!(locked && !locked.err && locked.hasLockLine && locked.explainsWhy && locked.instruction &&
       locked.ctaPresent && locked.shapes === 0),
    JSON.stringify(locked));
  if (!(locked && locked.hasLockLine)) await shot(page2, "fail-map-slim-locked.png");

  await shot(page2, "map-slim-locked.png");

  // The CTA is the gate's call to action: it must land on Flow with the
  // Markers panel showing (where a start marker is added).
  await page2.click('#session-map-bpmn-host [data-map-cta="mark-runs"]').catch((e) => console.log("cta", e.message));
  await wait(900);
  const ctaLanded = await page2.evaluate(() => {
    const flow = document.getElementById("session-layout-flow");
    const tab = document.querySelector('.anno-tab[data-anno="markers"]');
    const panel = document.querySelector('.anno-panel[data-panel="markers"]');
    return !!(flow && getComputedStyle(flow).display !== "none" &&
      tab && tab.classList.contains("active") &&
      panel && getComputedStyle(panel).display !== "none");
  }).catch(() => false);
  record("(e2) the lock CTA lands on Flow with the Markers panel showing",
    !!ctaLanded, ctaLanded ? "" : "Flow + Markers panel did not show");

  await app2.close().catch(() => {});

  // (f) Zero page errors across both launches.
  record("(f) zero PAGE ERRORs", pageErrors.length === 0,
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
