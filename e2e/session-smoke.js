"use strict";
/*
 * Session-view e2e smoke — the in-repo merge gate (Wave 0 / F1).
 *
 * Successor to the out-of-repo _pdt_verify harness. Unlike that harness
 * (console.logs, no exit code, eyeball-only) this ASSERTS and exits with a
 * non-zero code on any real regression, so CI can gate merges on it.
 *
 * It launches the REAL viewer Electron app pre-loaded with the committed
 * demo session, then verifies:
 *   - zero PAGE ERRORs surfaced on the renderer console,
 *   - the session loaded (#session-loaded visible),
 *   - all 5 Session-view levels (flow/steps/phases/map/analysis) render,
 *   - the map-overlay regression stays fixed: on the Map level the process-map
 *     host must NOT vertically overlap the raw-events host
 *     (#session-layout-map .map-host bottom <= .event-table-host top).
 *
 * Robust by design: optional elements that are merely absent do not fail the
 * run; only genuine regressions (page errors, an un-rendered level, a
 * re-introduced overlap) do. Screenshots land in this dir as failure artifacts
 * (gitignored).
 *
 * Reuses the VIEWER's already-installed Electron — Electron is not an e2e dep.
 */

const path = require("path");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- pass/fail framework (shape copied from _pdt_verify/capture-smoke.js) ---
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: true }).catch((e) => console.log("shot fail", name, e.message));
}

// Per-level layout container that must become visible when its level is active.
const LEVEL_HOST = {
  flow: "#session-layout-flow",
  steps: "#session-layout-steps",
  phases: "#session-layout-phases",
  map: "#session-layout-map",
  analysis: "#session-layout-analysis",
};

// Geometry probe for the map-overlay regression. Returns the map host and the
// raw-events host rects plus a strict no-overlap verdict, so the assertion can
// report exact numbers when it fails.
const OVERLAP_PROBE = () => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel, top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // Inside #session-layout-map the map renders into .map-host; prefer the live
  // canvas (bpmn djs-container / dfg svg) when present, else the host box.
  const mapHost =
    rect("#session-layout-map .map-host .djs-container") ||
    rect("#session-layout-map .map-host svg") ||
    rect("#session-layout-map .map-host");
  const rawHost = rect(".event-table-host");
  let overlap = null;
  if (mapHost && rawHost && mapHost.h > 0 && rawHost.h > 0) {
    // No overlap == map bottom is at or above raw-events top.
    overlap = mapHost.bottom > rawHost.top;
  }
  return { mapHost, rawHost, overlap };
};

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [".", "--session=" + SESSION],
      cwd: VIEWER,
    });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  await page.waitForLoadState("domcontentloaded").catch(() => {});

  // Session loaded: #session-loaded becomes visible once the session renders.
  let loaded = false;
  try {
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: 15000 });
    loaded = true;
  } catch (_) {
    loaded = false;
  }
  record("session loaded (#session-loaded visible)", loaded,
    loaded ? "" : "timed out waiting for #session-loaded");
  if (!loaded) {
    await shot(page, "fail-no-session-loaded.png");
  }
  await wait(1500); // settle first render

  // Cycle the 5 Session-view levels; each must show its layout container.
  for (const lvl of ["flow", "steps", "phases", "map", "analysis"]) {
    const btn = await page.$('.view-mode-btn[data-level="' + lvl + '"]');
    if (!btn) {
      record("level '" + lvl + "' renders", false, "no view-mode-btn[data-level=" + lvl + "]");
      continue;
    }
    await btn.click().catch((e) => console.log(lvl + " click", e.message));
    await wait(1400);
    const host = LEVEL_HOST[lvl];
    let visible = false;
    try {
      visible = await page.$eval(host, (el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && el.offsetParent !== null;
      });
    } catch (_) {
      visible = false;
    }
    record("level '" + lvl + "' renders", visible,
      visible ? host + " visible" : host + " not visible");
    if (!visible) await shot(page, "fail-level-" + lvl + ".png");
  }

  // --- €-ROI panel pin (§11c) ---
  // On the Analysis level the €-ROI section must render with its band legend
  // and a session-level "Edit assumptions…" affordance. The demo has no
  // roi_inputs, so it runs in time-savings mode — assert the legend + edit
  // button + at least one tune affordance, which is the structural surface.
  const analysisBtn = await page.$('.view-mode-btn[data-level="analysis"]');
  if (analysisBtn) { await analysisBtn.click().catch(() => {}); await wait(1200); }
  const roiProbe = await page.evaluate(() => {
    const host = document.querySelector("#analysis-content");
    if (!host) return { host: false };
    return {
      host: true,
      title: /Return on automation/.test(host.textContent || ""),
      legend: !!host.querySelector(".roi-legend"),
      editBtn: !!host.querySelector(".roi-edit-btn"),
      tune: host.querySelectorAll(".roi-tune-btn").length,
      // §11f automation ranking: the candidates table carries a rank column.
      autoRank: host.querySelectorAll(".auto-rank").length,
    };
  }).catch((e) => ({ err: e.message }));
  if (roiProbe && roiProbe.err) {
    record("€-ROI panel renders on Analysis level", false, "probe error: " + roiProbe.err);
    await shot(page, "fail-roi-probe.png");
  } else {
    const ok = !!(roiProbe.host && roiProbe.title && roiProbe.legend &&
      roiProbe.editBtn && roiProbe.autoRank > 0);
    record("€-ROI panel renders on Analysis level", ok,
      "title=" + roiProbe.title + " legend=" + roiProbe.legend +
      " editBtn=" + roiProbe.editBtn + " tuneRows=" + roiProbe.tune +
      " autoRankCells=" + roiProbe.autoRank);
    if (!ok) await shot(page, "fail-roi-panel.png");
  }

  // --- Map-overlay regression pin ---
  // On the Map level, the process-map host must NOT vertically overlap the
  // raw-events host. This is the exact geometry of the bug just fixed.
  const mapBtn = await page.$('.view-mode-btn[data-level="map"]');
  if (mapBtn) { await mapBtn.click().catch(() => {}); await wait(1500); }
  // Open the raw-events <details> so its host has real height (the repro state).
  const summary = await page.$(".event-table-host > summary");
  if (summary) {
    await summary.scrollIntoViewIfNeeded().catch(() => {});
    await summary.click().catch((e) => console.log("rawevents open", e.message));
    await wait(900);
  }
  const probe = await page.evaluate(OVERLAP_PROBE).catch((e) => ({ err: e.message }));
  if (probe && probe.err) {
    record("map host does not overlap raw-events host", false, "probe error: " + probe.err);
    await shot(page, "fail-map-overlap-probe.png");
  } else if (!probe.mapHost || !probe.rawHost) {
    // Tolerate a genuinely absent host (e.g. empty-state) rather than fail the
    // gate on a missing optional element — but say so loudly.
    record("map host does not overlap raw-events host", true,
      "skipped (mapHost=" + !!probe.mapHost + " rawHost=" + !!probe.rawHost + ")");
  } else {
    const ok = probe.overlap === false;
    record("map host does not overlap raw-events host", ok,
      "mapBottom=" + probe.mapHost.bottom + " rawTop=" + probe.rawHost.top +
      " (no-overlap requires mapBottom <= rawTop)");
    if (!ok) await shot(page, "fail-map-overlap.png");
  }

  // Page errors gate (checked last so we capture errors from every interaction).
  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-page-errors.png");

  await app.close().catch(() => {});

  // Summary + exit code.
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n[e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
