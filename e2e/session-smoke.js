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
 *   - the Session-view levels flow/steps/map render (R4 retired the Analysis
 *     level, its modules moved into the Overview; the BA-helper cut removed
 *     Phases and the top tab row),
 *   - the Session Export menu's "Map as SVG" and "Step map as BPMN" items
 *     each write their file,
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
const { launchViewer } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
let SESSION = SRC_SESSION; // overridden by a fresh re-normalized temp copy when possible
let FRESH = false;         // true once re-normalized into the temp copy (current pipeline output)
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;

// Re-normalize the committed demo into a TEMP copy so the viewer sees CURRENT
// pipeline output instead of the stale committed analysis.json -- and so
// example-aggregate is never regenerated in place (CLAUDE.md). Needs a Python
// with the pipeline deps: the bundled viewer/python if present (dev box), else
// `python` on PATH (CI installs requirements.txt). If neither can normalize,
// fall back to the committed session and SKIP the checks that write into the
// session folder (the reference-map round-trip).
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
  console.log("[e2e] note: could not re-normalize (no deps-bearing Python); using committed session; the reference-map round-trip will skip");
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
// R4: the Analysis level was retired -- its three modules moved into the
// Overview's Evidence host (#overview-evidence). The evidence assertions below
// navigate to Overview and read #overview-evidence instead of #analysis-content.
const LEVEL_HOST = {
  flow: "#session-layout-flow",
  steps: "#session-layout-steps",
  map: "#session-layout-map",
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

/* RP-04: an annotations.json that exists but cannot be read is an error the
   analyst sees, never an empty session, and nothing may write over it. A
   second launch on a temp copy (events + manifest from the demo, read only)
   whose annotations.json is cut off mid-write, the way a crash or a cancelled
   save leaves it, next to one good backup. Pins the whole chain: main's load
   report, the banner, the refused save (the real "Save note" verb), the
   refused Analyze, and the files byte for byte. */
async function unreadableAnnotationsPin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-e2e-unreadable-"));
  for (const f of ["events.jsonl", "manifest.json"]) fs.copyFileSync(path.join(SRC_SESSION, f), path.join(dir, f));
  const good = fs.readFileSync(path.join(SRC_SESSION, "annotations.json"), "utf-8");
  const truncated = good.slice(0, Math.floor(good.length / 2));
  fs.writeFileSync(path.join(dir, "annotations.json"), truncated);
  fs.writeFileSync(path.join(dir, "annotations.json.2"), good);
  const files = () => fs.readdirSync(dir).filter((n) => n.startsWith("annotations.json")).sort();
  const filesBefore = files();
  const untouched = () =>
    fs.readFileSync(path.join(dir, "annotations.json"), "utf-8") === truncated &&
    fs.readFileSync(path.join(dir, "annotations.json.2"), "utf-8") === good &&
    JSON.stringify(files()) === JSON.stringify(filesBefore);

  let v;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + dir], cwd: VIEWER });
  } catch (e) {
    record("RP-04: unreadable annotations.json launch", false, "could not launch: " + e.message);
    return;
  }
  const p = await v.app.firstWindow();
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
  const T = 20000;
  const banner = await p.waitForSelector("#annotations-error-banner", { state: "visible", timeout: T })
    .then(() => p.$eval("#annotations-error-banner", (el) => (el.textContent || "").trim()))
    .catch((e) => "NO BANNER: " + String(e.message).split("\n")[0]);
  record("RP-04: an unreadable annotations.json loads as an error banner naming the file and its backups",
    /annotations\.json in this session folder cannot be read/.test(banner) && /annotations\.json\.2/.test(banner),
    banner.slice(0, 260));

  // The real verb: pin a note on the Flow level. The save must be refused with
  // an error toast, and no file may change (no write, no backup rotation).
  const toastText = () => p.$eval("#toast", (el) => el.className.includes("error") ? (el.textContent || "") : "");
  let saveMsg = "";
  try {
    await p.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await p.locator("#anno-note").fill("RP-04 probe note", { timeout: T });
    await p.locator("#btn-save-note").click({ timeout: T });
    await p.waitForFunction(() => /was not saved/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: T });
    saveMsg = await toastText();
  } catch (e) { saveMsg = "no refusal shown: " + String(e.message).split("\n")[0]; }
  const afterSave = untouched();
  record("RP-04: an edit on that session is refused with an error naming the problem; annotations.json and its backups are untouched",
    /was not saved/.test(saveMsg) && /cannot be read/.test(saveMsg) && afterSave,
    "toast=" + JSON.stringify(saveMsg.slice(0, 200)) + " filesUntouched=" + afterSave);

  // Analyze rewrites annotations.json, so it is refused the same way.
  let analyzeMsg = "";
  try {
    await p.locator("#btn-normalize").click({ timeout: T });
    await p.waitForFunction(() => /Analysis stopped, nothing was changed/.test(
      (document.getElementById("normalize-log") || {}).textContent || ""), null, { timeout: 60000 });
    analyzeMsg = await p.$eval("#normalize-log", (el) => el.textContent || "");
  } catch (e) { analyzeMsg = "no refusal shown: " + String(e.message).split("\n")[0]; }
  const afterAnalyze = untouched();
  record("RP-04: Analyze on that session is refused with the reason; annotations.json is untouched",
    /Analysis stopped, nothing was changed: .*annotations\.json in this session folder cannot be read/.test(analyzeMsg) && afterAnalyze,
    "log=" + JSON.stringify(analyzeMsg.slice(-220)) + " filesUntouched=" + afterAnalyze);

  // The refused save logs one console error by design ("[session]
  // annotations.json not saved"); anything else is a real page error.
  const unexpected = errs.filter((t) => !/\[session\] annotations\.json not saved/.test(t));
  record("RP-04 launch: no page errors besides the expected save refusal", unexpected.length === 0,
    unexpected.length ? unexpected.slice(0, 3).join(" | ") : errs.length + " expected refusal line(s)");
  if (!(afterSave && afterAnalyze)) await shot(p, "fail-rp04-unreadable.png");
  await v.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  let app, viewer;
  try {
    // RP-36: a throwaway profile, never the developer's persisted UI state.
    viewer = await launchViewer(electron, {
      executablePath: electronPath,
      args: [".", "--session=" + SESSION],
      cwd: VIEWER,
    });
    app = viewer.app;
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

  // Cycle the Session-view levels; each must show its layout container.
  // (R4 retired Analysis; the BA-helper cut retired Phases.)
  for (const lvl of ["flow", "steps", "map"]) {
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

  // BA-helper cut (L1b): the app IS the Session view. No top tab row, no
  // "More" views menu, no Phases level, no Compare / Template / App Library
  // views, and none of their entry points; the Export menu offers the PDD and
  // the two map exports.
  const cut = await page.evaluate(() => {
    const n = (sel) => document.querySelectorAll(sel).length;
    const sessionView = document.getElementById("view-session");
    return {
      tabRow: n("nav.tabs") + n(".tab") + n("#btn-tabs-more-menu"),
      otherViews: n("#view-aggregate") + n("#view-canonical") + n("#view-vocabularies"),
      phases: n('.view-mode-btn[data-level="phases"]') + n("#session-layout-phases") + n("#btn-group-into-phase"),
      entryPoints: n("#btn-match-template") + n("#btn-classify-activities") + n("#btn-save-vocab") +
        n("#btn-steps-to-template") + n("#prep-session-cta"),
      sessionViewShown: !!(sessionView && getComputedStyle(sessionView).display !== "none"),
      exportItems: ["btn-session-pdd", "btn-session-map-svg", "btn-session-step-bpmn"]
        .map((id) => !!document.getElementById(id)),
    };
  }).catch((e) => ({ err: e.message }));
  record("BA-helper cut: no tab row, no other views, no Phases; Export offers PDD + map SVG + step BPMN",
    !!(cut && !cut.err && cut.tabRow === 0 && cut.otherViews === 0 && cut.phases === 0 &&
      cut.entryPoints === 0 && cut.sessionViewShown && cut.exportItems.every(Boolean)),
    JSON.stringify(cut));

  // Item 19: "Scope to playhead" is orphaned chrome on Overview (no visible
  // playhead there) but meaningful everywhere a timeline exists. We just
  // cycled through flow/steps/map (the loop above), so the button should
  // be visible now (last level = map, not overview); switch back to Flow
  // (has it) then Overview (hides it) to check both ends.
  await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
  await wait(500);
  const playheadOnFlow = await page.evaluate(() => {
    const b = document.getElementById("btn-scope-to-playhead");
    return !!(b && getComputedStyle(b).display !== "none");
  }).catch(() => false);
  await page.click('.view-mode-btn[data-level="overview"]').catch(() => {});
  await wait(500);
  const playheadOnOverview = await page.evaluate(() => {
    const b = document.getElementById("btn-scope-to-playhead");
    return !!(b && getComputedStyle(b).display !== "none");
  }).catch(() => true);
  record("item 19: 'Scope to playhead' hidden on Overview, visible on Flow",
    playheadOnFlow && !playheadOnOverview,
    "flow=" + playheadOnFlow + " overview=" + playheadOnOverview);

  // Item 20: .tl-act-app activity labels must never escape their band --
  // NOTE this is deliberately NOT the usual scrollWidth>clientWidth clipping
  // probe: text-overflow:ellipsis makes that comparison true by design
  // whenever a label like "Chrome" is legitimately elided to fit a narrow
  // band (the ellipsis IS the fix -- item 20 asked for "ellipsis... so
  // nothing clips", meaning no RAW unellipsized overflow, not that ellipsis
  // itself is forbidden). The actual pre-fix bug was a flex min-width:auto
  // default that kept the label's own BOX wider than the band -- so the
  // real regression pin is: the label's rendered box never exceeds the
  // band's available (padded) width, and where it's shown at all, ellipsis
  // is actually the active text-overflow (proving the CSS mechanism fired).
  await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
  await wait(800);
  const actAppBox = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".tl-act-app").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none") return;   // below the container-query hide threshold
      const band = el.closest(".tl-band.tl-activity");
      if (!band) return;
      const avail = band.clientWidth - 12;   // .tl-activity-label inset: 4px 6px
      if (el.clientWidth > avail + 1) {
        bad.push((el.textContent || "").trim() + " box=" + el.clientWidth + " avail=" + avail);
      }
      if ((el.textContent || "").trim() && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis") {
        bad.push((el.textContent || "").trim() + " truncated without ellipsis");
      }
    });
    return bad;
  }).catch((e) => ["probe error: " + e.message]);
  record("item 20: .tl-act-app never escapes its band; truncation (if any) is via ellipsis",
    actAppBox.length === 0,
    actAppBox.length ? "bad: " + actAppBox.join(", ") : "all fit");

  // NAV-AUDIT §A3 fix: a plain steps-lane band click SELECTS + SEEKS and does
  // NOT switch view; the Flow→Steps jump is the labeled "Open in Steps"
  // right-click item. Enable the (default-off) steps lane at the element notch
  // so bands carry a real step_id, then drive both paths.
  await page.evaluate(() => {
    const s = document.getElementById("grain-slider");
    if (s) { s.value = "0"; s.dispatchEvent(new Event("input", { bubbles: true })); }  // element
  });
  await wait(500);
  await page.evaluate(() => {
    const T = require("./views/flow-view-timeline.js");
    T.setLaneToggle("steps", true);
    T.renderTimeline();
  });
  await wait(600);
  const laneClick = await page.evaluate(() => {
    const State = require("./state.js");
    const levelBefore = State.getLevel();
    const band = document.querySelector(".tl-step-band[data-step-id]");
    if (!band) return { ok: false, why: "no step band", count: document.querySelectorAll(".tl-step-band").length };
    const sid = band.dataset.stepId;
    band.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return {
      ok: true,
      stayedFlow: levelBefore === "flow" && State.getLevel() === "flow",
      selected: State.getSelectedStepId() === sid,
      highlighted: band.classList.contains("tl-step-selected"),
    };
  }).catch((e) => ({ ok: false, why: e.message }));
  record("§A3: steps-lane band click selects + seeks WITHOUT a view switch (stays on Flow)",
    !!(laneClick.ok && laneClick.stayedFlow && laneClick.selected && laneClick.highlighted),
    JSON.stringify(laneClick));
  // "Open in Steps" on a band of the LAST run: the Steps view opened on the
  // pattern run (run 1) before, so the arrival has to open another run to
  // reveal the step.
  const openInSteps = await page.evaluate(() => {
    const s = require("./state.js").getSession();
    const runs = ((s.stats && s.stats.case_stats) || []).filter((c) => !c.parent_case_id)
      .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts));
    const last = runs[runs.length - 1];
    const caseOf = {};
    for (const st of ((s.annotations && s.annotations.steps) || [])) caseOf[st.step_id] = st.case_id;
    const band = [...document.querySelectorAll(".tl-step-band[data-step-id]")]
      .find((b) => last && caseOf[b.dataset.stepId] === last.case_id);
    if (!band) return { ok: false, why: "no steps-lane band of the last run" };
    band.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 300, clientY: 250 }));
    const menu = document.getElementById("tl-ctx-menu");
    const item = menu && [...menu.querySelectorAll("div")].find((d) => /open in steps/i.test(d.textContent || ""));
    if (!item) return { ok: false, why: "no Open in Steps item" };
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { ok: true, stepId: band.dataset.stepId, caseId: last.case_id, runs: runs.length };
  }).catch((e) => ({ ok: false, why: e.message }));
  // Where the step is in the Steps list: its run open (the only open one), its
  // row selected and inside the list's visible box.
  const revealProbe = (o) => page.evaluate((x) => {
    const State = require("./state.js");
    const layout = document.getElementById("session-layout-steps");
    const grp = [...document.querySelectorAll("#step-list .run-group")].find((g) => g.dataset.caseId === x.caseId);
    const row = grp && [...grp.querySelectorAll(".step-row")].find((r) => r.dataset.stepId === x.stepId);
    const lr = document.getElementById("step-list").getBoundingClientRect();
    const rr = row ? row.getBoundingClientRect() : null;
    return {
      onSteps: State.getLevel() === "steps" && !!layout && getComputedStyle(layout).display !== "none",
      selectionKept: State.getSelectedStepId() === x.stepId,
      runOpen: !!(grp && grp.classList.contains("open")),
      openRuns: document.querySelectorAll("#step-list .run-group.open").length,
      rowSelected: !!(row && row.classList.contains("selected")),
      rowInView: !!(rr && rr.top >= lr.top - 1 && rr.bottom <= lr.bottom + 1),
    };
  }, o).catch((e) => ({ err: e.message }));
  const revealed = (p) => !!(p && p.onSteps && p.selectionKept && p.runOpen && p.openRuns === 1 && p.rowSelected && p.rowInView);
  let openLanded = { onSteps: false };
  if (openInSteps.ok) {
    // The row scrolls smoothly into view: wait for the state, not a fixed time.
    await page.waitForFunction((x) => {
      const grp = [...document.querySelectorAll("#step-list .run-group")].find((g) => g.dataset.caseId === x.caseId);
      const row = grp && [...grp.querySelectorAll(".step-row")].find((r) => r.dataset.stepId === x.stepId);
      if (!row) return false;
      const lr = document.getElementById("step-list").getBoundingClientRect(), rr = row.getBoundingClientRect();
      return rr.top >= lr.top - 1 && rr.bottom <= lr.bottom + 1;
    }, openInSteps, { timeout: 15000 }).catch(() => {});
    openLanded = await revealProbe(openInSteps);
  }
  record("§A3: the labeled 'Open in Steps' right-click item switches to Steps and reveals the step inside its run (the run opens, the row is selected and in view)",
    !!(openInSteps.ok && openInSteps.runs >= 2 && revealed(openLanded)),
    JSON.stringify({ openInSteps, openLanded }));
  // A return (Flow, then back to Steps) restores the same run and step.
  let returned = null;
  if (openInSteps.ok) {
    await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
    await wait(500);
    await page.click('.view-mode-btn[data-level="steps"]').catch(() => {});
    await wait(900);
    returned = await revealProbe(openInSteps);
  }
  record("§A3: a return to Steps restores the same run and step (still open and selected)",
    revealed(returned), JSON.stringify(returned));
  if (!revealed(openLanded) || !revealed(returned)) await shot(page, "fail-open-in-steps.png");
  // Restore: back to Flow, steps lane off, screen notch (leave the view as found).
  await page.evaluate(() => {
    const T = require("./views/flow-view-timeline.js");
    T.setLaneToggle("steps", false);
    const s = document.getElementById("grain-slider");
    if (s) { s.value = "1"; s.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
  await wait(400);

  // --- ADR-0024 grain control: the single view-time roll-up slider ---
  // The slider exists; the Steps list reproduces the FINE count at the element
  // notch (detail never destroyed) and CONSOLIDATES at the screen notch.
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

  // R4: the Analysis modules now live in the Overview's Evidence host
  // (#overview-evidence). Navigating to Evidence = go to Overview (the default)
  // and read #overview-evidence. This helper replaces every old
  // "click data-level=analysis; read #analysis-content" navigation below.
  async function goEvidence() {
    const ob = await page.$('.view-mode-btn[data-level="overview"]');
    if (ob) { await ob.click().catch(() => {}); await wait(900); }
  }

  // BA helper L7a: the Steps level is the runs and their steps whatever the
  // Detail slider says. The ADR-0028 case tree (the old screen-notch default)
  // and the ADR-0024 roll-up rows are gone from Steps, so the same runs, the
  // same open run and the same step rows show at the element and the screen
  // notch. (This replaces the pin "element shows the fine count, screen
  // consolidates to work items": the slider no longer changes Steps.)
  async function goSteps() {
    const sb = await page.$('.view-mode-btn[data-level="steps"]');
    if (sb) { await sb.click().catch(() => {}); await wait(700); }
  }
  const stepsAtNotch = async (idx) => {
    await goSteps();
    await setGrainNotch(idx);
    return page.evaluate(() => ({
      runs: document.querySelectorAll("#step-list .run-group").length,
      open: [...document.querySelectorAll("#step-list .run-group.open")].map((g) => g.dataset.caseId || g.dataset.group),
      rows: [...document.querySelectorAll("#step-list .step-row")].map((r) => r.dataset.stepId),
      removed: document.querySelectorAll(
        "#step-list .wi-case-head, #step-list .wi-item-row, #step-list .grain-group-row, #step-list .backbone-row").length,
    })).catch((e) => ({ err: e.message }));
  };
  const atElement = await stepsAtNotch(0);
  const atScreen = await stepsAtNotch(1);
  if (grainSliderExists) {
    const same = !!(atElement && atScreen && !atElement.err && atElement.runs >= 2 && atElement.rows.length > 0 &&
      atElement.removed === 0 && atScreen.removed === 0 &&
      JSON.stringify(atElement) === JSON.stringify(atScreen));
    record("Steps shows the same runs and steps at every Detail notch (no case tree, no roll-up rows)", same,
      JSON.stringify({ element: atElement && { runs: atElement.runs, open: atElement.open, rows: (atElement.rows || []).length },
        screen: atScreen && { runs: atScreen.runs, open: atScreen.open, rows: (atScreen.rows || []).length } }));
    if (!same) await shot(page, "fail-steps-notch.png");
  }

  // R1 (approachability redesign, 2026-07-03): "Process efficiency" and the
  // resident "Waste by step/screen" module are GONE from the Analysis stack.
  // The judgment editor relocated into a "Where the time goes" row's
  // expand-in-place body -- reachable only at the element notch (the
  // business-required override is process_label-scoped). At a coarser notch
  // the same expansion shows a read-only "set the Detail slider to element"
  // message instead. This IS the itemisation-follows-the-notch pin now.
  await goEvidence();
  const noResidentModules = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll("#overview-evidence .analysis-module-title"))
      .map((e) => (e.textContent || "").trim());
    return {
      titles,
      hasEfficiency: titles.some((t) => /process efficiency/i.test(t)),
      hasWasteModule: titles.some((t) => /^waste by/i.test(t)),
    };
  }).catch((e) => ({ err: e.message }));
  record("(R1) 'Process efficiency' is not a resident module", !!(noResidentModules && !noResidentModules.hasEfficiency),
    JSON.stringify(noResidentModules));
  record("(R1) 'Waste by step/screen' is not a resident module", !!(noResidentModules && !noResidentModules.hasWasteModule),
    JSON.stringify(noResidentModules));

  // CI-4: this pin flaked on GitHub Actions only (hidden:true). It now waits for
  // each observable state (the notch applied, the Overview shown with the time
  // module rendered and open, the row's expand button visible, the row body
  // unhidden) with a generous timeout instead of fixed sleeps, and clicks
  // through a locator that re-resolves if a re-render replaced the row. A wait
  // that times out is recorded in the result (`waitFailed`), never swallowed.
  const STATE_TIMEOUT = 15000;
  async function tsJudgeExpansionAt(idx) {
    const waits = [];
    const waitFor = (label, p) => p.catch((e) => { waits.push(label + ": " + String(e.message).split("\n")[0]); });
    await page.evaluate((i) => {
      const s = document.getElementById("grain-slider");
      if (!s) return;
      s.value = String(i);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, idx);
    const notch = ["element", "screen", "app", "phase", "case"][idx];
    await waitFor("notch applied", page.waitForFunction((n) =>
      require("./state.js").getGrain() === n &&
      (document.getElementById("grain-notch-lbl") || {}).textContent === n, notch, { timeout: STATE_TIMEOUT }));
    await waitFor("overview click", page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: STATE_TIMEOUT }));
    await waitFor("time module rendered", page.waitForSelector(
      '#overview-evidence .analysis-module[data-module="time"]', { state: "visible", timeout: STATE_TIMEOUT }));
    await page.evaluate(() => {
      const mod = document.querySelector('#overview-evidence .analysis-module[data-module="time"]');
      if (mod && !mod.open) mod.open = true;
    });
    const expand = page.locator("#overview-evidence .ts-row").first().locator(".ts-judge-expand");
    await waitFor("expand visible", expand.waitFor({ state: "visible", timeout: STATE_TIMEOUT }));
    await waitFor("expand click", expand.click({ timeout: STATE_TIMEOUT }));
    await waitFor("row body shown", page.waitForFunction(() => {
      const row = document.querySelector("#overview-evidence .ts-row");
      const body = row && row.querySelector(".ts-judge-body");
      return !!(body && !body.hidden);
    }, null, { timeout: STATE_TIMEOUT }));
    const probe = await page.evaluate(() => {
      const row = document.querySelector("#overview-evidence .ts-row");
      const body = row && row.querySelector(".ts-judge-body");
      return {
        rowPresent: !!row,
        hidden: body ? body.hidden : null,
        hasEditor: !!(body && body.querySelector(".waste-row")),
        readOnlyNote: !!(body && /Detail slider/.test(body.textContent || "")),
      };
    }).catch((e) => ({ err: e.message }));
    if (waits.length) probe.waitFailed = waits;
    return probe;
  }
  const tsAtElement = await tsJudgeExpansionAt(0);   // element notch
  record("(R1) 'Where the time goes' row expand-in-place opens the judgment editor at the element notch",
    !!(tsAtElement && !tsAtElement.err && tsAtElement.rowPresent && tsAtElement.hidden === false && tsAtElement.hasEditor),
    JSON.stringify(tsAtElement));
  if (!(tsAtElement && tsAtElement.hasEditor)) await shot(page, "fail-ts-judge-editor.png");

  const tsAtScreen = await tsJudgeExpansionAt(1);   // screen notch (coarser)
  record("(R1) the same row expansion is read-only (element-only) at a coarser detail level",
    !!(tsAtScreen && !tsAtScreen.err && tsAtScreen.rowPresent && !tsAtScreen.hasEditor && tsAtScreen.readOnlyNote),
    JSON.stringify(tsAtScreen));
  if (!(tsAtScreen && tsAtScreen.readOnlyNote)) await shot(page, "fail-ts-readonly.png");
  await setGrainNotch(1);   // leave at the default (screen) notch for the pins below

  // --- Automation candidates render as finding cards (R1 §5) ---
  // The ranked table is gone; candidates render via the SAME shared
  // finding-card component the Overview findings feed uses (finding-cards.js
  // -- .ov-finding markup), one card per candidate, in rank order, with the
  // Confirm/Dismiss decision preserved and reachable behind the card's
  // expand-in-place evidence body.
  await goEvidence();
  const autoCardsProbe = await page.evaluate(() => {
    const mod = document.querySelector('#overview-evidence .analysis-module[data-module="automation"]');
    if (mod && !mod.open) mod.open = true;
    const body = mod && mod.querySelector(".analysis-module-body");
    if (!body) return { present: false };
    const cards = body.querySelectorAll(".auto-cards .ov-finding");
    return {
      present: true,
      cardCount: cards.length,
      noOldTable: !body.querySelector("table.analysis-table"),
      firstClaim: cards.length ? (cards[0].querySelector(".ov-finding-claim") || {}).textContent : null,
    };
  }).catch((e) => ({ err: e.message }));
  record("(R1) automation candidates render as finding cards, not a ranked table",
    !!(autoCardsProbe && !autoCardsProbe.err && autoCardsProbe.present &&
      autoCardsProbe.cardCount > 0 && autoCardsProbe.noOldTable),
    JSON.stringify(autoCardsProbe));
  if (!(autoCardsProbe && autoCardsProbe.cardCount > 0)) await shot(page, "fail-automation-cards.png");

  // Confirm/Dismiss must still work: expand the first card and click Confirm;
  // the SAME analysis_overrides automation_confirmed write path (unchanged).
  // CI-4: this pin flaked on GitHub Actions only (active=false after a fixed
  // 900 ms sleep). It now waits for each observable state with a generous
  // timeout: the card body open (Confirm visible), the Confirm button active
  // for THIS card's segment, and the decision written to annotations.json
  // (the "persists" half of the check's name, which the old version never
  // read back). A failed wait is recorded as the reason, never swallowed.
  const confirmRes = { found: false };
  try {
    const card = page.locator("#overview-evidence .auto-cards .ov-finding").first();
    const confirmLoc = card.locator('.auto-btn[data-confirm="true"]');
    confirmRes.found = (await confirmLoc.count()) > 0;
    if (confirmRes.found) {
      const sig = await card.locator(".auto-decision").getAttribute("data-segment-signature");
      confirmRes.signature = sig;
      confirmRes.activeBefore = await confirmLoc.evaluate((b) => b.classList.contains("active"));
      await card.click({ timeout: STATE_TIMEOUT });               // expand in place
      await confirmLoc.waitFor({ state: "visible", timeout: STATE_TIMEOUT });
      await confirmLoc.click({ timeout: STATE_TIMEOUT });
      await page.waitForFunction((s) =>
        [...document.querySelectorAll("#overview-evidence .auto-cards .auto-decision")].some((d) =>
          d.dataset.segmentSignature === s && d.querySelector('.auto-btn[data-confirm="true"].active')),
      sig, { timeout: STATE_TIMEOUT });
      confirmRes.active = true;
      const annoPath = path.join(SESSION, "annotations.json");
      const deadline = Date.now() + STATE_TIMEOUT;
      while (Date.now() < deadline && !confirmRes.persisted) {
        try {
          const a = JSON.parse(fs.readFileSync(annoPath, "utf-8"));
          confirmRes.persisted = (a.analysis_overrides || []).some((o) =>
            o && o.segment_signature === sig && o.automation_confirmed === true);
        } catch (_) { /* mid-write; read again */ }
        if (!confirmRes.persisted) await wait(200);
      }
    }
  } catch (e) {
    confirmRes.error = String(e.message).split("\n")[0];
  }
  const confirmOk = !!(confirmRes.found && confirmRes.activeBefore === false &&
    confirmRes.active && confirmRes.persisted);
  record("(R1) a finding card's Confirm button works (activates + persists the decision)",
    confirmOk, JSON.stringify(confirmRes));
  if (!confirmOk) await shot(page, "fail-automation-confirm.png");

  // Item 21: the Evidence module collapse persists per analyst (localStorage,
  // pdt.analysis.* keys — the module keys are unchanged by the R4 relocation).
  // Two halves: (i) collapsing a module WRITES the key; (ii) the stored key
  // survives a re-render. Use the "time" module in #overview-evidence.
  // (i) collapse via the native summary → the toggle listener persists "0".
  const wroteKey = await page.evaluate(async () => {
    const mod = document.querySelector('#overview-evidence .analysis-module[data-module="time"]');
    if (!mod) return { present: false };
    if (mod.open) mod.querySelector("summary").click();   // collapse
    await new Promise((r) => setTimeout(r, 50));           // let the toggle event fire
    let stored = null;
    try { stored = localStorage.getItem("pdt.analysis.time"); } catch (_) {}
    return { present: true, stored };
  }).catch((e) => ({ err: e.message }));
  // (ii) re-render the Overview (which re-renders the Evidence modules); the
  // module must come back collapsed from storage.
  const persisted = await page.evaluate(() => {
    require("./views/overview-view.js").renderOverviewLevel();
    const after = document.querySelector('#overview-evidence .analysis-module[data-module="time"]');
    return after ? after.open : null;
  }).catch((e) => ({ err: e.message }));
  record("(disclosure 21) Evidence module collapse persists across a re-render",
    !!(wroteKey && !wroteKey.err && wroteKey.present && wroteKey.stored === "0" &&
      persisted === false),
    JSON.stringify({ wroteKey, reopenedOpen: persisted }));
  // Restore the default (expanded) so the persisted key doesn't leak to a human run.
  await page.evaluate(() => {
    try { localStorage.removeItem("pdt.analysis.time"); } catch (_) {}
    require("./views/overview-view.js").renderOverviewLevel();
  }).catch(() => {});

  // Item 1: no recording linked → the tall black video stage collapses to a
  // slim band, and the freed height goes to the timeline + notes. On the Flow
  // level the video pane must carry the `no-recording` class and be much
  // shorter than the annotations/notes pane beside it.
  const flowBtn2 = await page.$('.view-mode-btn[data-level="flow"]');
  if (flowBtn2) { await flowBtn2.click().catch(() => {}); await wait(900); }
  const videoBand = await page.evaluate(() => {
    const pane = document.getElementById("video-pane");
    const notes = document.querySelector("#session-layout-flow .annotations-pane");
    if (!pane || !notes) return { present: false };
    const pr = pane.getBoundingClientRect();
    const nr = notes.getBoundingClientRect();
    return {
      present: true,
      collapsedClass: pane.classList.contains("no-recording"),
      videoHidden: getComputedStyle(document.getElementById("video")).display === "none",
      linkAffordance: !!document.getElementById("btn-link-recording"),
      paneH: Math.round(pr.height),
      notesH: Math.round(nr.height),
    };
  }).catch((e) => ({ err: e.message }));
  const videoBandOk = !!(videoBand && !videoBand.err && videoBand.present &&
    videoBand.collapsedClass && videoBand.videoHidden && videoBand.linkAffordance &&
    videoBand.paneH < videoBand.notesH);
  record("(disclosure 1) no-recording video stage collapses to a slim band (notes gets the space)",
    videoBandOk, JSON.stringify(videoBand));
  if (!videoBandOk) await shot(page, "fail-video-collapse.png");

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

  // --- ADR-0024 grain on the Process diagram (BPMN) tab -----------------------
  // The Process diagram is mined only at Element/Phase. Picking a COARSE grain
  // (screen/app/case) on that tab must NOT dead-end on an empty message: the
  // grain control auto-falls back to the live Flow diagram (which rolls up), so
  // a grain change always yields a usable map. And the "N nodes / Open / Reveal"
  // status line must reflect the file actually shown -- hidden on the Flow
  // diagram, not a stale process_map.bpmn count.
  await page.click('#session-layout-map .panel-tab[data-map="bpmn"]').catch(() => {});
  await page.selectOption("#session-map-level", "element").catch(() => {});
  await wait(700);
  await page.selectOption("#session-map-level", "screen").catch(() => {});  // coarse -> fall back
  await wait(900);
  const fb = await page.evaluate(() => {
    const dfg = document.getElementById("session-map-dfg-host");
    const dfgVisible = dfg && getComputedStyle(dfg).display !== "none";
    const dfgHasMap = dfg && !!(dfg.querySelector("svg") || dfg.querySelector("canvas"));
    const dfgTab = document.querySelector('#session-layout-map .panel-tab[data-map="dfg"]');
    const status = document.getElementById("process-map-status");
    const statusHidden = !status || getComputedStyle(status).display === "none";
    return { dfgVisible: !!dfgVisible, dfgHasMap, tabFlipped: !!(dfgTab && dfgTab.classList.contains("active")), statusHidden };
  }).catch((e) => ({ err: e.message }));
  record("grain on the Process diagram falls back to a usable Flow diagram (no dead end)",
    !!(fb && !fb.err && fb.dfgVisible && fb.dfgHasMap && fb.tabFlipped), JSON.stringify(fb));
  record("the 'N nodes' status line hides on the live Flow diagram (no stale file count)",
    !!(fb && !fb.err && fb.statusHidden), JSON.stringify(fb));

  // --- AD-11: the map exports live in the Session Export menu -----------------
  // Pin the VERB: open the menu, click the item, and assert the written file
  // (the OS save dialog is stubbed to a temp path, the shell reveal to a no-op).
  async function exportViaMenu(itemId, outPath) {
    await app.evaluate(({ dialog, shell }, p) => {
      global.__pdtSaveDefault = null;
      dialog.showSaveDialog = async (_w, opts) => {
        global.__pdtSaveDefault = (opts && opts.defaultPath) || null;
        return { canceled: false, filePath: p };
      };
      shell.showItemInFolder = () => {};
    }, outPath);
    await page.click("#btn-session-export-menu");
    await page.click("#" + itemId);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) break;
      await wait(250);
    }
    const suggested = await app.evaluate(() => global.__pdtSaveDefault).catch(() => null);
    const text = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
    try { fs.unlinkSync(outPath); } catch (_) {}
    return { bytes: text.length, head: text.slice(0, 200), text, suggested };
  }
  // Start from Overview: the verb opens the Map level (button state included)
  // before it reads the diagram.
  await page.click('.view-mode-btn[data-level="overview"]').catch(() => {});
  await wait(600);
  const svgOut = path.join(os.tmpdir(), "pdt-e2e-map-" + Date.now() + ".svg");
  const svgRes = await exportViaMenu("btn-session-map-svg", svgOut);
  const svgLanded = await page.evaluate(() => {
    const layout = document.getElementById("session-layout-map");
    const btn = document.querySelector('.view-mode-btn[data-level="map"]');
    return !!(layout && getComputedStyle(layout).display !== "none" && btn && btn.classList.contains("active"));
  }).catch(() => false);
  const svgOk = svgRes.bytes > 0 && /<svg[\s>]/.test(svgRes.text) && /\.svg$/.test(svgRes.suggested || "") && svgLanded;
  record("AD-11: Export > Map as SVG (from Overview) opens the Map and writes the shown map as an SVG file",
    svgOk, "bytes=" + svgRes.bytes + " suggested=" + svgRes.suggested + " onMap=" + svgLanded + " head=" + JSON.stringify(svgRes.head.slice(0, 80)));
  if (!svgOk) await shot(page, "fail-export-map-svg.png");
  if (!FRESH) {
    record("AD-11: Export > Step map as BPMN (skipped: session not re-normalized)", true,
      "the export would analyze into the committed demo folder");
  } else {
    const bpmnOut = path.join(os.tmpdir(), "pdt-e2e-step-" + Date.now() + ".bpmn");
    const bpmnRes = await exportViaMenu("btn-session-step-bpmn", bpmnOut);
    const bpmnOk = bpmnRes.bytes > 0 && /<(?:[\w-]+:)?definitions[\s>]/.test(bpmnRes.text) &&
      /<(?:[\w-]+:)?(?:task|userTask)[\s>]/.test(bpmnRes.text) && /\.bpmn$/.test(bpmnRes.suggested || "");
    record("AD-11: Export > Step map as BPMN writes the step-level BPMN file",
      bpmnOk, "bytes=" + bpmnRes.bytes + " suggested=" + bpmnRes.suggested + " head=" + JSON.stringify(bpmnRes.head.slice(0, 80)));
    if (!bpmnOk) await shot(page, "fail-export-step-bpmn.png");
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

    // Fork from the Process diagram (BPMN) at the Activity level. §B2 moved
    // the activity-taxonomy cell into the Expert drawer — reach it the way a
    // user now does (selector update only; the fork assertions are unchanged).
    if (mapBtn) { await mapBtn.click().catch(() => {}); await wait(700); }
    await page.evaluate(() => {
      const d = document.getElementById("map-expert-drawer");
      if (d) d.open = true;
    }).catch(() => {});
    await page.click("#btn-expert-activity-bpmn").catch((e) => console.log("expert activity bpmn", e.message));
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

    // CI-3: the gallery stays clickable while Raw events is open, whatever the
    // Session summary state. Opening Raw events used to freeze the Map layout
    // at a fixed height, so the gallery opened later was squeezed and its
    // buttons sat under the drawer's summary, which took the clicks. A trial
    // click runs Playwright's full actionability check (visible, stable, and
    // the button itself receives the pointer) without clicking. The drawer
    // must really be open here (the map-overlay pin above opened it), or the
    // check would prove nothing.
    const galleryReach = {};
    for (const summaryOpen of [false, true]) {
      await page.evaluate((open) => {
        const p = document.getElementById("session-summary");
        if (p) p.open = open;
      }, summaryOpen);
      const state = await page.evaluate(() => ({
        drawerOpen: !!(document.querySelector(".event-table-host") || {}).open,
        summaryOpen: !!(document.getElementById("session-summary") || {}).open,
      }));
      const btns = page.locator("#refmap-list [data-rm-act]");
      const n = await btns.count();
      const blocked = [];
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const act = await b.getAttribute("data-rm-act");
        await b.click({ trial: true, timeout: 5000 })
          .catch((e) => blocked.push(act + ": " + String(e.message).split("\n")[0]));
      }
      galleryReach[summaryOpen ? "summaryOpen" : "summaryClosed"] = Object.assign(state, { buttons: n, blocked });
    }
    const reachOk = ["summaryOpen", "summaryClosed"].every((k) => {
      const r = galleryReach[k];
      return r && r.drawerOpen && r.summaryOpen === (k === "summaryOpen") && r.buttons > 0 && r.blocked.length === 0;
    });
    record("CI-3: every reference-map gallery button is clickable with Raw events open, Session summary open or closed",
      reachOk, JSON.stringify(galleryReach));
    if (!reachOk) await shot(page, "fail-refmap-gallery-reach.png");

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

    // --- G-1 pin: Fork from the DEFAULT map state -----------------------------
    // The owner's real session: the Map opens on the Flow diagram at the screen
    // detail level (no Process-diagram file), and Fork silently did nothing —
    // while this suite forked only from a pre-selected, still-rendered BPMN cell
    // and stayed green. Pin the real flow: from the default state, Fork must
    // create a copy AND open the editor (it self-drives to the step-level
    // Process diagram, the supported post-§B2 source).
    await page.evaluate(() => {
      // Reset to the default cell the way a fresh session presents it.
      const dfgTab = document.querySelector('#session-layout-map .panel-tab[data-map="dfg"]');
      if (dfgTab) dfgTab.click();
      const lvl = document.getElementById("session-map-level");
      if (lvl) { lvl.value = "screen"; lvl.dispatchEvent(new Event("change")); }
    }).catch(() => {});
    await wait(900);
    const beforeDefaultFork = await page.evaluate(() => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      return RM.list(State.getSession().annotations).length;
    }).catch(() => -1);
    await page.click("#btn-fork-refmap").catch((e) => console.log("default-state fork", e.message));
    await wait(2500);   // setMapCell("step") render + fork + editor open
    const defFork = await page.evaluate(() => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      const s = State.getSession();
      const maps = RM.list(s.annotations);
      const e = maps[maps.length - 1] || null;
      const overlay = document.getElementById("refmap-editor-overlay");
      const host = document.getElementById("refmap-editor-host");
      return {
        count: maps.length,
        fileOnDisk: e ? RM.fileExists(s.sessionFolder, e) : false,
        sourceLevel: e && e.source ? e.source.level : null,
        editorOpen: !!(overlay && overlay.style.display !== "none"),
        editorSvg: !!(host && host.querySelector("svg")),
      };
    }).catch((e) => ({ err: e.message }));
    const defForkOk = defFork && !defFork.err &&
      defFork.count === beforeDefaultFork + 1 && defFork.fileOnDisk &&
      defFork.editorOpen && defFork.editorSvg && defFork.sourceLevel === "step";
    record("G-1: Fork from the DEFAULT map state creates a copy AND opens the editor",
      defForkOk, "before=" + beforeDefaultFork + " " + JSON.stringify(defFork));
    if (!defForkOk) await shot(page, "fail-refmap-default-fork.png");
    else await shot(page, "g1-fork-default-state-editor.png");
    await page.click("#btn-refmap-editor-close", { timeout: 2500 }).catch(() => {});
    await wait(400);
  }

  // --- Item 6: an inserted marker shows at once as pending, with one call to
  // action that runs Analyze; after it the marker is a real one and the case
  // count follows. Runs Analyze into the session folder, so FRESH only.
  if (!FRESH) {
    record("item 6: pending marker insert (skipped: session not re-normalized)", true,
      "Analyze would write into the committed demo folder");
  } else {
    await markerInsertPin();
  }

  async function markerInsertPin() {
    const T = 20000;
    const LABEL = "E2E pending run";
    const INSERT_AT = "2026-05-14T09:01:20.000Z";   // the gap between the demo's first two runs
    const cases = () => page.evaluate(() => ({
      analyzed: ((require("./state.js").getSession().analysis || {}).case_quality || {}).case_count,
      bands: document.querySelectorAll("#timeline .tl-case-band").length,
      badge: ((document.querySelector("#overview-content .ov-badge-text") || {}).textContent || "").trim(),
    }));
    const pinState = () => page.evaluate((label) => {
      const rows = [...document.querySelectorAll("#markers-list .marker-row")];
      const row = rows.find((r) => (r.textContent || "").includes(label));
      const panel = document.querySelector('.anno-panel[data-panel="markers"]');
      const cta = document.getElementById("btn-apply-marker-edits");
      return {
        row: row ? { pending: row.classList.contains("pending"), inserted: row.classList.contains("inserted"),
          text: (row.textContent || "").replace(/\s+/g, " ").trim() } : null,
        markersPanelShown: !!(panel && getComputedStyle(panel).display !== "none"),
        pendingBars: document.querySelectorAll("#timeline .tl-marker-pending").length,
        pendingLabel: [...document.querySelectorAll("#timeline .tl-marker-label-pending")]
          .map((l) => l.textContent).find((t) => t.includes(label)) || null,
        cta: cta ? (cta.textContent || "").trim() : null,
      };
    }, LABEL);
    let before = null, pending = null, applied = null, onDisk = false, err = null;
    try {
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector("#timeline .tl-band", { state: "visible", timeout: T });
      before = await cases();
      // Right-click the timeline at INSERT_AT: the real contextmenu handler
      // opens the real insert menu; its item and the label prompt are clicked.
      await page.evaluate((iso) => {
        const tl = document.getElementById("timeline");
        const evs = require("./state.js").getSession().events;
        const first = new Date(evs[0].timestamp).getTime();
        const last = new Date(evs[evs.length - 1].timestamp).getTime();
        const r = tl.getBoundingClientRect();
        const x = r.left + ((new Date(iso).getTime() - first) / (last - first)) * r.width;
        tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: r.top + 4 }));
      }, INSERT_AT);
      await page.locator("#tl-ctx-menu div", { hasText: "Insert Start marker here" }).click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill(LABEL, { timeout: T });
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      await page.waitForFunction((label) => [...document.querySelectorAll("#markers-list .marker-row.pending")]
        .some((r) => (r.textContent || "").includes(label)), LABEL, { timeout: T });
      pending = Object.assign(await pinState(), { cases: await cases() });
      // Saved as an insert edit near INSERT_AT (the right-click x maps to a
      // time through the timeline's pixel width, so allow 2 s either way).
      const a = JSON.parse(fs.readFileSync(path.join(SESSION, "annotations.json"), "utf-8"));
      onDisk = (a.marker_edits || []).some((e) => e && e.op === "insert" && e.marker_type === "start" &&
        e.label === LABEL && Math.abs(Date.parse(e.timestamp) - Date.parse(INSERT_AT)) <= 2000);
    } catch (e) { err = String(e.message).split("\n")[0]; }
    const pendingOk = !!(pending && pending.row && pending.row.pending && pending.row.inserted &&
      pending.markersPanelShown && pending.pendingBars >= 1 && pending.pendingLabel === LABEL + " (pending)" &&
      pending.cta === "Analyze to apply 1 marker change" && onDisk &&
      pending.cases.analyzed === before.analyzed && pending.cases.bands === before.bands);
    record("item 6: a Start marker inserted from the timeline menu shows at once as pending (list + timeline + one call to action), before any Analyze",
      pendingOk, JSON.stringify({ before, pending, onDisk, err }));
    if (!pendingOk) await shot(page, "fail-marker-pending.png");

    // The call to action runs Analyze (with its usual re-analyze confirmation).
    try {
      await page.locator("#btn-apply-marker-edits").click({ timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await page.waitForFunction((label) => !document.getElementById("btn-apply-marker-edits") &&
        [...document.querySelectorAll("#markers-list .marker-row")]
          .some((r) => (r.textContent || "").includes(label) && !r.classList.contains("pending")),
      LABEL, { timeout: 120000 });
      applied = Object.assign(await pinState(), { cases: await cases() });
    } catch (e) { err = String(e.message).split("\n")[0]; }
    const appliedOk = !!(applied && before && applied.row && !applied.row.pending && applied.row.inserted &&
      applied.pendingBars === 0 && applied.cta === null &&
      applied.cases.analyzed === before.analyzed + 1 && applied.cases.bands === before.bands + 1 &&
      new RegExp("\\b" + (before.analyzed + 1) + " cases\\b").test(applied.cases.badge));
    record("item 6: its call to action runs Analyze; the marker becomes a real one and the case count goes up by one",
      appliedOk, JSON.stringify({ before: before && before.analyzed, applied, err }));
    if (!appliedOk) await shot(page, "fail-marker-applied.png");
  }

  // Page errors gate (checked last so we capture errors from every interaction).
  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-page-errors.png");

  await viewer.close();

  await unreadableAnnotationsPin();

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
