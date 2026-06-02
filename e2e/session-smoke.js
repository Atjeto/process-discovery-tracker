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
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
let SESSION = SRC_SESSION; // overridden by a fresh re-normalized temp copy when possible
let FRESH = false;         // true once re-normalized, so analysis.json carries a current roi block
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;

// Re-normalize the committed demo into a TEMP copy so the viewer sees CURRENT
// pipeline output (incl. the §11c roi block) instead of the stale committed
// analysis.json -- and so example-aggregate is never regenerated in place
// (CLAUDE.md). Needs a Python with the pipeline deps: the bundled viewer/python
// if present (dev box), else `python` on PATH (CI installs requirements.txt).
// If neither can normalize, fall back to the committed session and SKIP the
// roi-panel assertion (honest degradation -- the panel correctly hides with no
// roi block, so asserting it against stale data would false-fail).
function freshenSession() {
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-e2e-"));
    for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) {
      const s = path.join(SRC_SESSION, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
    }
    const bundled = path.join(VIEWER, "python", "python.exe");
    const pys = fs.existsSync(bundled) ? [bundled] : ["python", "python3"];
    const norm = path.join(REPO, "normalization", "normalize.py");
    for (const py of pys) {
      try {
        execFileSync(py, [norm, tmp, "--mine"], { cwd: REPO, stdio: "ignore" });
        SESSION = tmp; FRESH = true;
        return;
      } catch (_) { /* try the next interpreter */ }
    }
  } catch (_) { /* fall through to the committed-session fallback */ }
  console.log("[e2e] note: could not re-normalize (no deps-bearing Python); using committed session — roi-panel check will skip");
}
freshenSession();

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

  // --- ADR-0024 grain control: the single view-time roll-up slider ---
  // The slider exists; the Steps list reproduces the FINE count at the element
  // notch (detail never destroyed) and CONSOLIDATES at the screen notch; and
  // the €-ROI total is INVARIANT across notches (the load-bearing guarantee).
  async function setGrainNotch(idx) {
    // Move the shared grain slider and fire its input handler (renderer wiring).
    await page.evaluate((i) => {
      const s = document.getElementById("grain-slider");
      if (!s) return;
      s.value = String(i);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, idx);
    await wait(800);
  }
  const grainSliderExists = await page.$eval("#grain-slider", () => true).catch(() => false);
  record("grain slider (#grain-slider) present", grainSliderExists,
    grainSliderExists ? "" : "no #grain-slider in the view-mode bar");

  // Read the €-ROI expected total on the Analysis level (for the invariance check).
  async function roiTotalText() {
    const ab = await page.$('.view-mode-btn[data-level="analysis"]');
    if (ab) { await ab.click().catch(() => {}); await wait(900); }
    return page.evaluate(() => {
      const el = document.querySelector("#analysis-content .roi-total-big");
      return el ? (el.textContent || "").trim() : null;
    }).catch(() => null);
  }
  const roiAtScreen = await roiTotalText();   // default notch = screen

  // Count the Steps-list rows at the element vs screen notch.
  async function stepRowCountAt(idx) {
    const sb = await page.$('.view-mode-btn[data-level="steps"]');
    if (sb) { await sb.click().catch(() => {}); await wait(700); }
    await setGrainNotch(idx);
    return page.evaluate(() => document.querySelectorAll("#step-list .step-row").length).catch(() => 0);
  }
  const elementCount = await stepRowCountAt(0);   // element notch
  const screenCount = await stepRowCountAt(1);    // screen notch (default)
  if (grainSliderExists) {
    const consolidates = elementCount > 0 && screenCount > 0 && screenCount < elementCount;
    record("grain roll-up: element shows the fine count, screen consolidates", consolidates,
      "element=" + elementCount + " rows, screen=" + screenCount + " rows (screen must be fewer, both > 0)");
    if (!consolidates) await shot(page, "fail-grain-rollup.png");
  }

  // €-ROI total must be identical at another notch (it is time-based and reads
  // event-stream segments, not step grain — invariant by construction).
  await setGrainNotch(2);   // app notch
  const roiAtApp = await roiTotalText();
  if (grainSliderExists) {
    const invariant = roiAtScreen != null && roiAtScreen === roiAtApp;
    record("€-ROI total is invariant across grain notches", invariant,
      "screen='" + roiAtScreen + "' app='" + roiAtApp + "' (must match)");
    if (!invariant) await shot(page, "fail-roi-invariance.png");
  }
  // The step-grained Analysis itemisation follows the notch: at "screen" the
  // Waste/Time-study sections re-bucket by screen (a "Waste by screen" heading).
  await setGrainNotch(1);   // screen notch
  const analysisFollowsNotch = await (async () => {
    const ab = await page.$('.view-mode-btn[data-level="analysis"]');
    if (ab) { await ab.click().catch(() => {}); await wait(900); }
    return page.evaluate(() => {
      const h = document.querySelector("#analysis-content");
      return h ? /Waste by screen/i.test(h.textContent || "") : false;
    }).catch(() => false);
  })();
  if (grainSliderExists) {
    record("Analysis itemisation follows the grain notch (Waste by screen)", analysisFollowsNotch,
      analysisFollowsNotch ? "" : "expected a 'Waste by screen' section at the screen notch");
    if (!analysisFollowsNotch) await shot(page, "fail-analysis-grain.png");
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
  } else if (!FRESH) {
    record("€-ROI panel renders on Analysis level (skipped — session not re-normalized)", true,
      "no deps-Python to produce a fresh roi block; panel correctly hidden, not asserted");
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

  // --- ADR-0024 map-connectivity regression pin ---
  // The headline regression: at the default SCREEN grain the Flow diagram (DFG)
  // fanned out into a per-case hairball because the screen key was the raw
  // window title (which embeds the case value -- "Salesforce - Order #10900").
  // The screen axis must group VALUE-FREE so the map is a clean connected chain:
  // ONE weakly-connected component, ONE start, ONE reachable end. (Pre-fix this
  // demo screen-grain DFG had 3+ distinct end nodes; the 10-session aggregate had
  // 35.) We drive the live cytoscape graph (dfg-viewer exposes host.__cy).
  if (mapBtn) { await mapBtn.click().catch(() => {}); await wait(800); }
  await setGrainNotch(1);   // screen notch (the default + the regressing one)
  await page.click('#session-layout-map .panel-tab[data-map="dfg"]').catch((e) => console.log("dfg tab", e.message));
  await wait(1400);
  const connProbe = await page.evaluate(() => {
    const host = document.getElementById("session-map-dfg-host");
    const cy = host && host.__cy;
    if (!cy) return { rendered: false };
    const nodes = cy.nodes().map((n) => n.id());
    const edges = cy.edges().map((e) => ({ s: e.data("source"), t: e.data("target") }));
    const parent = {}; nodes.forEach((n) => (parent[n] = n));
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    edges.forEach((e) => { if (parent[e.s] != null && parent[e.t] != null) parent[find(e.s)] = find(e.t); });
    const components = new Set(nodes.map(find)).size;
    const indeg = {}, outdeg = {};
    nodes.forEach((n) => { indeg[n] = 0; outdeg[n] = 0; });
    edges.forEach((e) => { outdeg[e.s]++; indeg[e.t]++; });
    const sourceIds = nodes.filter((n) => indeg[n] === 0);
    const sinkIds = nodes.filter((n) => outdeg[n] === 0);
    // Readability: the layout must read LEFT-TO-RIGHT (dagre rankDir LR), not as a
    // radial hub (the breadthfirst fallback when dagre wasn't wired). In an LR flow
    // the source sits leftmost and the sink rightmost, and the graph is wider than
    // tall. A radial star fails both. Read live node positions off cytoscape.
    const bb = cy.nodes().boundingBox();
    const xOf = (id) => cy.getElementById(id).position("x");
    const xs = nodes.map(xOf);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    // Tolerance 5px (not 1): dagre can inset the source/sink node a hair from
    // the exact bounding-box edge without changing that the layout reads L->R.
    // A radial fallback would miss by far more than 5px, so this still catches it.
    const srcLeftmost = sourceIds.length === 1 && Math.abs(xOf(sourceIds[0]) - minX) < 5;
    const sinkRightmost = sinkIds.length === 1 && Math.abs(xOf(sinkIds[0]) - maxX) < 5;
    return {
      rendered: true, nodes: nodes.length, edges: edges.length, components,
      sources: sourceIds.length, sinks: sinkIds.length,
      leftToRight: srcLeftmost && sinkRightmost && bb.w >= bb.h,
      aspect: Math.round((bb.w / Math.max(1, bb.h)) * 10) / 10,
    };
  }).catch((e) => ({ err: e.message }));
  if (connProbe && connProbe.err) {
    record("screen-grain Flow diagram is a connected chain", false, "probe error: " + connProbe.err);
  } else if (!connProbe.rendered) {
    record("screen-grain Flow diagram is a connected chain", true,
      "skipped (no DFG rendered — empty session/state)");
  } else {
    const ok = connProbe.components === 1 && connProbe.sources === 1 && connProbe.sinks === 1;
    record("screen-grain Flow diagram is a connected chain (1 component, 1 start, 1 end)", ok,
      "nodes=" + connProbe.nodes + " edges=" + connProbe.edges +
      " components=" + connProbe.components + " sources=" + connProbe.sources +
      " sinks=" + connProbe.sinks + " (the per-case fan-out would push sinks/components up)");
    if (!ok) await shot(page, "fail-map-connectivity.png");

    // Layout readability: dagre LR (source leftmost, sink rightmost, wider-than-tall),
    // NOT the radial breadthfirst hub that appears when dagre isn't wired up.
    record("screen-grain Flow diagram reads left-to-right (dagre LR, not a radial hub)",
      connProbe.leftToRight,
      "leftToRight=" + connProbe.leftToRight + " aspect(w/h)=" + connProbe.aspect +
      " (radial fallback would put aspect ~1 and break source-leftmost/sink-rightmost)");
    if (!connProbe.leftToRight) await shot(page, "fail-map-radial.png");
  }

  // --- ADR-0019 Reference Maps round-trip pin ---------------------------------
  // A reference map is a decoupled, editable BPMN copy forked from the mined map.
  // The honest-leaf contract has a full lifecycle: Fork (one-way leaf; the mined
  // map is untouched) -> Edit (full bpmn-js palette) -> Save (debounced saveXML to
  // derived_maps/<id>.bpmn) -> reload (reopen re-reads the blob) -> Delete+Undo
  // (the blob is retained so Ctrl+Z restores a WORKING, still-edited entry).
  // Validated end-to-end in _pdt_verify/refmap-verify.js; pinned here so the
  // round-trip + inverse can't silently regress.
  //
  // Guarded on FRESH: forking writes into <session>/derived_maps/, so it must run
  // ONLY against the re-normalized TEMP copy, never the committed demo folder
  // (CLAUDE.md: example-aggregate is committed data — never mutate it in place).
  if (!FRESH) {
    record("reference-map round-trip (skipped — session not re-normalized)", true,
      "no deps-Python for a temp copy; not forking into the committed demo folder");
  } else {
    const PROBE = "RT_PIN_EDIT"; // a label no mined node carries
    const minedBpmn = path.join(SESSION, "process_map.bpmn");
    const minedBefore = fs.existsSync(minedBpmn)
      ? fs.statSync(minedBpmn).size + ":" + fs.readFileSync(minedBpmn, "utf-8").length : null;

    // Fork from the Process diagram (BPMN) at the Activity level.
    if (mapBtn) { await mapBtn.click().catch(() => {}); await wait(700); }
    await page.click('#session-layout-map .panel-tab[data-map="bpmn"]').catch((e) => console.log("bpmn tab", e.message));
    await page.selectOption("#session-map-level", "activity").catch(() => {});
    await wait(1400);
    await page.click("#btn-fork-refmap").catch((e) => console.log("fork", e.message));
    await wait(1600);
    const forked = await page.evaluate(() => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      const s = State.getSession(), e = RM.list(s.annotations)[0] || null;
      const host = document.getElementById("refmap-editor-host");
      const palette = host && host.querySelector(".djs-palette");
      return {
        count: RM.list(s.annotations).length,
        fileOnDisk: e ? RM.fileExists(s.sessionFolder, e) : false,
        hasHash: !!(e && e.forked_from_hash),
        editorSvg: !!(host && host.querySelector("svg")),
        paletteVisible: palette ? getComputedStyle(palette).display !== "none" : false,
      };
    }).catch((e) => ({ err: e.message }));
    const forkOk = forked && !forked.err && forked.count === 1 &&
      forked.fileOnDisk && forked.hasHash && forked.editorSvg && forked.paletteVisible;
    record("reference map: Fork makes a decoupled editable copy", forkOk,
      JSON.stringify(forked));
    if (!forkOk) await shot(page, "fail-refmap-fork.png");

    // Edit: a real, undoable bpmn-js label change fires the debounced disk save.
    const edited = await page.evaluate((probe) => {
      const host = document.getElementById("refmap-editor-host");
      const v = host && host.__bpmnViewer;
      if (!v) return { ok: false, why: "no editor viewer handle" };
      let reg, modeling;
      try { reg = v.get("elementRegistry"); modeling = v.get("modeling"); }
      catch (e) { return { ok: false, why: e.message }; }
      const task = reg.filter((el) => /Task|Activity/.test((el && el.type) || ""))[0];
      if (!task) return { ok: false, why: "no task element" };
      modeling.updateLabel(task, probe);
      return { ok: true };
    }, PROBE).catch((e) => ({ ok: false, why: e.message }));
    await wait(1400); // > the 600 ms save debounce in bpmn-viewer.js

    // Save: the on-disk blob now carries the edit.
    const savedToDisk = await page.evaluate((probe) => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      const s = State.getSession(), e = RM.list(s.annotations)[0];
      const xml = e ? RM.readBpmn(s.sessionFolder, e) : null;
      return !!(xml && xml.indexOf(probe) !== -1);
    }, PROBE).catch(() => false);

    // Reload: close + reopen the editor (re-reads the blob) -> the edit survives.
    await page.click("#btn-refmap-editor-close", { timeout: 2500 }).catch(() => {});
    await wait(700);
    await page.click("#btn-toggle-refmaps").catch(() => {});
    await wait(300);
    await page.click('#refmap-list [data-rm-act="edit"]').catch((e) => console.log("reopen", e.message));
    await wait(1400);
    const reloadedHasEdit = await page.evaluate(async (probe) => {
      let xml = null;
      try { xml = await require("./bpmn-viewer.js").exportXml(); } catch (_) {}
      return !!(xml && xml.indexOf(probe) !== -1);
    }, PROBE).catch(() => false);
    await page.click("#btn-refmap-editor-close", { timeout: 2500 }).catch(() => {});
    await wait(500);
    const rtOk = edited.ok && savedToDisk && reloadedHasEdit;
    record("reference map: Edit -> Save -> reload round-trips the edit", rtOk,
      "edit=" + edited.ok + " savedToDisk=" + savedToDisk + " reloadedHasEdit=" + reloadedHasEdit +
      (edited.why ? " (" + edited.why + ")" : ""));
    if (!rtOk) await shot(page, "fail-refmap-roundtrip.png");

    // Label legibility: the row/toolbar buttons carry multi-word TEXT (Edit /
    // Duplicate / Delete; ⑂ Fork map; Reference maps) and once reused the shared
    // .icon-btn.xs 22px icon-SQUARE, which clipped the labels and made the red
    // Delete overlap Duplicate. A button is clipped when its content overflows
    // its box (scrollWidth > clientWidth). Pin zero-clipped so it can't regress.
    const clipped = await page.evaluate(() => {
      const sels = [".refmap-row-actions .icon-btn", "#btn-fork-refmap", "#btn-toggle-refmaps"];
      const bad = [];
      sels.forEach((sel) => document.querySelectorAll(sel).forEach((b) => {
        if (b.scrollWidth > b.clientWidth + 1) bad.push((b.textContent || "").trim() + " (" + b.clientWidth + "<" + b.scrollWidth + ")");
      }));
      return bad;
    }).catch((e) => ["probe error: " + e.message]);
    record("reference map: action/toolbar button labels are not clipped", clipped.length === 0,
      clipped.length ? "clipped: " + clipped.join(", ") : "all labels fit their buttons");
    if (clipped.length) await shot(page, "fail-refmap-labels.png");

    // Inverse: Delete drops the row but keeps the blob, so one Ctrl+Z restores a
    // WORKING entry that still carries the edit (the COHERENCE-AUDIT requirement).
    const delUndo = await page.evaluate(async (probe) => {
      const State = require("./state.js"), RM = require("./reference-maps.js"), Session = require("./session.js");
      const s = State.getSession();
      const m = RM.list(s.annotations)[0];
      if (!m) return { err: "no map to delete" };
      RM.destroy({ sessionFolder: s.sessionFolder, anno: s.annotations, id: m.map_id });
      await Session.saveAnnotationsWithUndo(s.annotations, "Delete reference map");
      const afterDel = RM.list(s.annotations).length;
      await Session.performUndo();
      const restored = RM.list(s.annotations)[0] || null;
      const xml = restored ? RM.readBpmn(s.sessionFolder, restored) : null;
      return {
        afterDel, afterUndo: RM.list(s.annotations).length,
        restoredHasEdit: !!(xml && xml.indexOf(probe) !== -1),
      };
    }, PROBE).catch((e) => ({ err: e.message }));
    const invOk = delUndo && !delUndo.err && delUndo.afterDel === 0 &&
      delUndo.afterUndo === 1 && delUndo.restoredHasEdit;
    record("reference map: Delete -> Ctrl+Z restores the edited copy (inverse)", invOk,
      JSON.stringify(delUndo));
    if (!invOk) await shot(page, "fail-refmap-undo.png");

    // Decoupled leaf: the mined map on disk was never touched by any of the above.
    const minedAfter = fs.existsSync(minedBpmn)
      ? fs.statSync(minedBpmn).size + ":" + fs.readFileSync(minedBpmn, "utf-8").length : null;
    record("reference map: the mined map is untouched (one-way leaf)",
      minedBefore != null && minedBefore === minedAfter,
      "before=" + minedBefore + " after=" + minedAfter);
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
