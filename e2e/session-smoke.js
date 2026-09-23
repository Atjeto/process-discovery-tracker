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
 *   - the Session Export menu's "Process map (image)" and "Process map
 *     (BPMN)" items each write their file (no As-Is copy chosen yet: the map
 *     on the Map level),
 *   - the chrome: the Run select on Flow only, one Open menu, the version in
 *     Help, Analyze session secondary once analyzed, the active level legible
 *     under the mouse,
 *   - the automation candidates: every repeated sequence, by total time, with
 *     no Confirm or Dismiss and no rank (AD-20, P1.5),
 *   - Flow's side panel opens on Screenshots (no Notes), its thumbnails show
 *     local time, the More menu holds what it should with and without a video,
 *     and the Raw events drawer shows on Flow only,
 *   - the one process map (built from the runs' steps) is one connected graph
 *     read left to right with every path drawn, and the Map's one act makes
 *     the PDD's As-Is map: after a rename it analyzes first so the copy
 *     carries the new name (round trip, labels, delete + undo, one-way leaf),
 *   - the Detail slider (the view-time grain) is gone, and the session summary
 *     shows on the Overview only.
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
const { launchViewer, logActionError } = require("./throwaway-profile.js");

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
    // The screenshots too (the step detail shows a step's own, P2.16).
    const shots = path.join(SRC_SESSION, "screenshots");
    if (fs.existsSync(shots)) {
      fs.mkdirSync(path.join(tmp, "screenshots"));
      for (const f of fs.readdirSync(shots)) fs.copyFileSync(path.join(shots, f), path.join(tmp, "screenshots", f));
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

/* RP-04: an annotations.json that exists but cannot be read is an error the
   analyst sees, never an empty session, and nothing may write over it. A
   second launch on a temp copy (events + manifest from the demo, read only)
   whose annotations.json is cut off mid-write, the way a crash or a cancelled
   save leaves it, next to one good backup. Pins the whole chain: main's load
   report, the banner, the refused save (the real "Insert Start marker here"
   verb of the Flow timeline), the refused Analyze, and the files byte for
   byte. */
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
    .catch((e) => { logActionError("RP-04 banner", e); return "NO BANNER: " + String(e.message).split("\n")[0]; });
  record("RP-04: an unreadable annotations.json loads as an error banner naming the file and its backups",
    /annotations\.json in this session folder cannot be read/.test(banner) && /annotations\.json\.2/.test(banner),
    banner.slice(0, 260));

  // The real verb: insert a Start marker from the Flow timeline's menu. The
  // save must be refused with an error toast, and no file may change (no
  // write, no backup rotation).
  const toastText = () => p.$eval("#toast", (el) => el.className.includes("error") ? (el.textContent || "") : "");
  let saveMsg = "";
  try {
    await p.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await p.waitForSelector("#timeline .tl-band", { state: "visible", timeout: T });
    await p.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
    await p.evaluate(() => {
      const tl = document.getElementById("timeline");
      const r = tl.getBoundingClientRect();
      tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
        clientX: r.left + r.width * 0.3, clientY: r.top + 4 }));
    });
    await p.locator("#tl-ctx-menu div", { hasText: "Insert Start marker here" }).click({ timeout: T });
    await p.locator(".modal-prompt .modal-input").fill("RP-04 probe run", { timeout: T });
    await p.locator(".modal-prompt .modal-ok").click({ timeout: T });
    await p.waitForFunction(() => /was not saved/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: T });
    saveMsg = await toastText();
  } catch (e) { logActionError("RP-04 insert marker", e); saveMsg = "no refusal shown: " + String(e.message).split("\n")[0]; }
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
  } catch (e) { logActionError("RP-04 analyze", e); analyzeMsg = "no refusal shown: " + String(e.message).split("\n")[0]; }
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

  // The session summary is the Overview's one line: the old panel above every
  // level is gone, and no other level shows the summary.
  const summaryHome = await page.evaluate(() => {
    const line = document.querySelector("#session-layout-overview #ov-summary .ov-summary-line");
    const layouts = ["flow", "steps", "map"].map((l) => document.getElementById("session-layout-" + l));
    return {
      oldPanel: document.querySelectorAll("#session-summary, .session-summary").length,
      inOverview: !!line,
      outsideOverview: layouts.reduce((n, el) => n + (el ? el.querySelectorAll("#ov-summary").length : 0), 0),
      text: line ? (line.textContent || "").trim() : null,
    };
  }).catch((e) => ({ err: e.message }));
  record("the session summary is one line on the Overview only (no panel above the levels)",
    !!(summaryHome && !summaryHome.err && summaryHome.oldPanel === 0 && summaryHome.inOverview &&
      summaryHome.outsideOverview === 0 && /\b4 runs\b/.test(summaryHome.text || "")),
    JSON.stringify(summaryHome));

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

  // P1.2: the run select dims the other runs on the Flow timeline and changes
  // nothing elsewhere, so it shows on Flow only; "Scope to playhead" is gone
  // on every level. Checked on each level in turn.
  const runSelect = {};
  for (const lvl of ["overview", "flow", "steps", "map"]) {
    await page.click('.view-mode-btn[data-level="' + lvl + '"]').catch(() => {});
    await wait(400);
    runSelect[lvl] = await page.evaluate(() => {
      const el = document.getElementById("case-scope");
      return !!(el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0);
    }).catch(() => null);
  }
  const runSelectText = await page.evaluate(() => ({
    label: ((document.querySelector("#case-scope .case-scope-label") || {}).textContent || "").trim(),
    first: ((document.querySelector("#case-scope-select option") || {}).textContent || "").trim(),
    playhead: document.querySelectorAll("#btn-scope-to-playhead").length,
  })).catch((e) => ({ err: e.message }));
  record("P1.2: the Run select shows on Flow only (All runs); Scope to playhead is gone",
    runSelect.flow === true && runSelect.overview === false && runSelect.steps === false && runSelect.map === false &&
      runSelectText.label === "Run:" && runSelectText.first === "All runs" && runSelectText.playhead === 0,
    JSON.stringify({ runSelect, runSelectText }));

  // P1.2 / P3.1 / P3.2 / P2.2: the chrome says each thing once. No VIEW label,
  // per-level hint, hidden level descriptions or top-bar date; the version is
  // in Help; one Open menu holds the folder picker and the recent sessions.
  // P1.11: once the session is analyzed, Analyze session is secondary, so the
  // Overview's one orange button is its next act.
  await page.click('.view-mode-btn[data-level="overview"]').catch(() => {});
  await wait(400);
  const chrome = await page.evaluate(() => {
    const n = (sel) => document.querySelectorAll(sel).length;
    const shown = (el) => !!(el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0);
    return {
      gone: n(".view-mode-label") + n("#view-mode-help") + n(".view-mode-desc") + n("#topbar-meta") + n("#onboarding-card"),
      version: ((document.getElementById("help-version") || {}).textContent || "").trim(),
      openMenu: ((document.querySelector("#btn-recent-menu span") || {}).textContent || "").trim(),
      openFolderInMenu: !!document.querySelector("#recent-menu-popup #btn-open-session"),
      analyzeIsPrimary: document.getElementById("btn-normalize").classList.contains("primary"),
      orangeOnOverview: [...document.querySelectorAll("#session-loaded button.primary")].filter(shown)
        .map((b) => (b.textContent || "").trim()),
    };
  }).catch((e) => ({ err: e.message }));
  record("P1.2/P3.1/P2.2/P1.11: no VIEW label, level hint or top-bar date; the version is in Help; one Open menu; Analyze session secondary, one orange button on the Overview",
    !!(chrome && !chrome.err && chrome.gone === 0 && /^Version \d+\.\d+\.\d+/.test(chrome.version) &&
      chrome.openMenu === "Open" && chrome.openFolderInMenu && chrome.analyzeIsPrimary === false &&
      chrome.orangeOnOverview.length === 1 && chrome.orangeOnOverview[0] === "Confirm Run 1 in Steps"),
    JSON.stringify(chrome));

  // F3: the active level button stays legible under the mouse (the global
  // button hover used to give it a light background under near-white text).
  const activeHover = {};
  try {
    const active = page.locator(".view-mode-btn.active");
    activeHover.rest = await active.evaluate((b) => { const c = getComputedStyle(b); return { bg: c.backgroundColor, fg: c.color }; });
    await active.hover({ timeout: 15000 });
    await wait(250);
    activeHover.hover = await active.evaluate((b) => { const c = getComputedStyle(b); return { bg: c.backgroundColor, fg: c.color }; });
    await page.mouse.move(2, 600);
  } catch (e) {
    logActionError("F3 active hover", e);
    activeHover.err = String(e.message).split("\n")[0];
  }
  const lum = (rgb) => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || "");
    if (!m) return null;
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(+m[1]) + 0.7152 * ch(+m[2]) + 0.0722 * ch(+m[3]);
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (x == null || y == null) ? 0 : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  activeHover.ratio = activeHover.hover ? Math.round(contrast(activeHover.hover.bg, activeHover.hover.fg) * 100) / 100 : 0;
  record("F3: the active level button keeps a legible label under the mouse (contrast at least 3:1, label colour unchanged)",
    !!(!activeHover.err && activeHover.ratio >= 3 && activeHover.hover.fg === activeHover.rest.fg),
    JSON.stringify(activeHover));

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
  // right-click item. Enable the (default-off) steps lane (one band per step,
  // each carrying its step_id), then drive both paths.
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
  // Item 1: the steps lane shows the steps as they are (no roll-up by a grain
  // notch): one band per visible step, named as the step is named.
  const laneBands = await page.evaluate(() => {
    const steps = ((require("./state.js").getSession().annotations || {}).steps || [])
      .filter((st) => st && st.state !== "hidden" && st.time_range && st.time_range.start && st.time_range.end &&
        Date.parse(st.time_range.end) > Date.parse(st.time_range.start));
    const bands = [...document.querySelectorAll(".tl-step-band[data-step-id]")];
    const byId = Object.fromEntries(steps.map((st) => [st.step_id, st]));
    return {
      steps: steps.length, bands: bands.length,
      named: bands.every((b) => byId[b.dataset.stepId] && (b.textContent || "") === byId[b.dataset.stepId].name),
      folded: bands.filter((b) => / steps\)/.test(b.title || "")).length,
    };
  }).catch((e) => ({ err: e.message }));
  record("item 1: the Flow steps lane shows one band per step, named as the step (no roll-up)",
    !!(laneBands && !laneBands.err && laneBands.steps > 0 && laneBands.bands === laneBands.steps &&
      laneBands.named && laneBands.folded === 0), JSON.stringify(laneBands));
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
  // Restore: back to Flow, steps lane off (leave the view as found).
  await page.evaluate(() => {
    const T = require("./views/flow-view-timeline.js");
    T.setLaneToggle("steps", false);
  });
  await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
  await wait(400);

  // --- Item 1: the Detail slider and the grain are gone ---
  // One drafting unit, no view-time roll-up: no slider in the view-mode bar and
  // no grain in the viewer state.
  const grainGone = await page.evaluate(() => ({
    slider: document.querySelectorAll("#grain-slider, #grain-control, .grain-control, #grain-notch-lbl").length,
    stateGrain: typeof require("./state.js").getGrain,
  })).catch((e) => ({ err: e.message }));
  record("item 1: the Detail slider is gone (no control, no grain in the state)",
    !!(grainGone && !grainGone.err && grainGone.slider === 0 && grainGone.stateGrain === "undefined"),
    JSON.stringify(grainGone));

  // R4: the Analysis modules now live in the Overview's Evidence host
  // (#overview-evidence). Navigating to Evidence = go to Overview (the default)
  // and read #overview-evidence.
  async function goEvidence() {
    const ob = await page.$('.view-mode-btn[data-level="overview"]');
    if (ob) { await ob.click().catch(() => {}); await wait(900); }
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

  // Item 1: the "Where the time goes" judgment editor is always editable (it
  // was element-notch-gated). CI-4: the pin waits for each observable state
  // (the Overview shown with the time module rendered and open, the row's
  // expand button visible, the row body unhidden) with a generous timeout
  // instead of fixed sleeps, and clicks through a locator that re-resolves if
  // a re-render replaced the row. A wait that times out is recorded in the
  // result (`waitFailed`), never swallowed.
  const STATE_TIMEOUT = 15000;
  async function tsJudgeExpansion() {
    const waits = [];
    const waitFor = (label, p) => p.catch((e) => {
      logActionError("(R1) time row: " + label, e);
      waits.push(label + ": " + String(e.message).split("\n")[0]);
    });
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
        hasEditor: !!(body && body.querySelector(".waste-row.waste-row-editable")),
        readOnlyNote: !!(body && /Detail slider/.test(body.textContent || "")),
      };
    }).catch((e) => ({ err: e.message }));
    if (waits.length) probe.waitFailed = waits;
    return probe;
  }
  const tsJudge = await tsJudgeExpansion();
  record("(R1) 'Where the time goes' row expand-in-place opens the judgment editor, always editable (no Detail slider gate)",
    !!(tsJudge && !tsJudge.err && tsJudge.rowPresent && tsJudge.hidden === false && tsJudge.hasEditor &&
      !tsJudge.readOnlyNote),
    JSON.stringify(tsJudge));
  if (!(tsJudge && tsJudge.hasEditor)) await shot(page, "fail-ts-judge-editor.png");

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
  // AD-20: the automation candidates are the one home of a repeated step
  // sequence. Every repeated sequence is a card, longest total time first (the
  // order the PDD's 5.3 lists them in); each card leads with the pipeline's
  // readable label (the application by its readable name, no raw process
  // token); no line points at the findings any more.
  const autoLabels = await page.evaluate(() => {
    const a = require("./state.js").getSession().analysis || {};
    const expected = (a.automation_candidates || []).filter((c) => c.data_sufficiency === "multi_instance")
      .sort((x, y) => (y.total_elapsed_ms || 0) - (x.total_elapsed_ms || 0));
    const claims = [...document.querySelectorAll("#overview-evidence .auto-cards .ov-finding-claim")]
      .map((e) => (e.textContent || "").trim());
    return {
      expected: expected.length, cards: claims.length,
      totals: expected.map((c) => c.total_elapsed_ms),
      labelsLead: claims.length > 0 && claims.every((c, i) => !!expected[i] && c.startsWith(expected[i].label + ": ran ")),
      rawToken: claims.some((c) => /\.exe\b/i.test(c)),
      inFindingsNote: document.querySelectorAll("#overview-evidence .auto-in-findings").length,
      takeaway: ((document.querySelector('#overview-evidence .analysis-module[data-module="automation"] .analysis-module-takeaway') || {}).textContent || "").trim(),
      firstClaim: claims[0] || null,
    };
  }).catch((e) => ({ err: e.message }));
  record("AD-20: every repeated sequence is an automation card, longest total time first, led by its readable label; no 'already in the findings' line",
    !!(autoLabels && !autoLabels.err && autoLabels.expected >= 2 && autoLabels.cards === autoLabels.expected &&
      autoLabels.labelsLead && !autoLabels.rawToken && autoLabels.inFindingsNote === 0 &&
      /^\d+ candidates?, longest total time first$/.test(autoLabels.takeaway)),
    JSON.stringify(autoLabels));

  // P1.5: Confirm and Dismiss reached nothing downstream and the rank was an
  // unexplained number: a candidate card is its claim, with no control, no
  // rank and no caption above the cards.
  const autoCard = await page.evaluate(() => {
    const mod = document.querySelector('#overview-evidence .analysis-module[data-module="automation"]');
    const cardsHost = mod && mod.querySelector(".auto-cards");
    return {
      cards: cardsHost ? cardsHost.querySelectorAll(".ov-finding").length : 0,
      controls: cardsHost ? cardsHost.querySelectorAll("button, input, select, a").length : -1,
      decisions: document.querySelectorAll(".auto-decision, .auto-btn, [data-confirm]").length,
      ranks: document.querySelectorAll(".auto-card, [data-rank]").length,
      captions: mod ? mod.querySelectorAll(".analysis-caption").length : -1,
      chips: document.querySelectorAll("#overview-content .ov-finding-tier").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("P1.5 + P2.7: an automation card has no Confirm, Dismiss or rank; no card carries a tier chip",
    !!(autoCard && !autoCard.err && autoCard.cards > 0 && autoCard.controls === 0 && autoCard.decisions === 0 &&
      autoCard.ranks === 0 && autoCard.captions === 0 && autoCard.chips === 0),
    JSON.stringify(autoCard));
  if (!(autoCard && autoCard.cards > 0 && autoCard.decisions === 0)) await shot(page, "fail-automation-cards-controls.png");

  // Item 21: the Evidence module collapse persists per analyst (localStorage,
  // pdt.analysis.* keys — the module keys are unchanged by the R4 relocation).
  // P1.10: collapsed is the default. Both directions, on the "time" module in
  // #overview-evidence: opening it writes "1" and it comes back open after a
  // re-render; collapsing it writes "0" and it comes back collapsed.
  const toggleTime = (open) => page.evaluate(async (want) => {
    const mod = document.querySelector('#overview-evidence .analysis-module[data-module="time"]');
    if (!mod) return { present: false };
    if (mod.open !== want) mod.querySelector("summary").click();
    await new Promise((r) => setTimeout(r, 50));           // let the toggle event fire
    let stored = null;
    try { stored = localStorage.getItem("pdt.analysis.time"); } catch (_) {}
    require("./views/overview-view.js").renderOverviewLevel();
    const after = document.querySelector('#overview-evidence .analysis-module[data-module="time"]');
    return { present: true, stored, afterRerender: after ? after.open : null };
  }, open).catch((e) => ({ err: e.message }));
  const opened = await toggleTime(true);
  const collapsed = await toggleTime(false);
  record("(disclosure 21) Evidence module open and collapse both persist across a re-render",
    !!(opened && opened.present && opened.stored === "1" && opened.afterRerender === true &&
      collapsed && collapsed.present && collapsed.stored === "0" && collapsed.afterRerender === false),
    JSON.stringify({ opened, collapsed }));
  // Restore the default (collapsed) so the persisted key doesn't leak to a human run.
  await page.evaluate(() => {
    try { localStorage.removeItem("pdt.analysis.time"); } catch (_) {}
    require("./views/overview-view.js").renderOverviewLevel();
  }).catch(() => {});

  // Item 1: no recording linked → the tall black video stage collapses to a
  // slim band, and the freed height goes to the timeline + the side panel. On
  // the Flow level the video pane must carry the `no-recording` class and be
  // much shorter than the screenshots/markers panel beside it.
  const flowBtn2 = await page.$('.view-mode-btn[data-level="flow"]');
  if (flowBtn2) { await flowBtn2.click().catch(() => {}); await wait(900); }
  const videoBand = await page.evaluate(() => {
    const pane = document.getElementById("video-pane");
    const side = document.querySelector("#session-layout-flow .annotations-pane");
    if (!pane || !side) return { present: false };
    const pr = pane.getBoundingClientRect();
    const nr = side.getBoundingClientRect();
    return {
      present: true,
      collapsedClass: pane.classList.contains("no-recording"),
      videoHidden: getComputedStyle(document.getElementById("video")).display === "none",
      linkAffordance: ((document.getElementById("btn-link-recording") || {}).textContent || "").trim(),
      paneH: Math.round(pr.height),
      sideH: Math.round(nr.height),
    };
  }).catch((e) => ({ err: e.message }));
  const videoBandOk = !!(videoBand && !videoBand.err && videoBand.present &&
    videoBand.collapsedClass && videoBand.videoHidden && videoBand.linkAffordance === "Attach video..." &&
    videoBand.paneH < videoBand.sideH);
  record("(disclosure 1) no-recording video stage collapses to a slim band (the side panel gets the space; its verb is More's Attach video...)",
    videoBandOk, JSON.stringify(videoBand));
  if (!videoBandOk) await shot(page, "fail-video-collapse.png");

  // --- P1.6 + AD-17 / F4 / P1.1: Flow's side panel --------------------------
  // The Notes tab and its lane are gone (notes never reached the PDD);
  // Screenshots is the panel's first and default tab, next to Markers. The
  // thumbnails show local time, the timeline's and the markers' clock (F4).
  // The shortcuts overlay is gone from every level (Help keeps the list).
  const sidePanel = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("#session-layout-flow .anno-tab")].map((t) => ({
      anno: t.dataset.anno, active: t.classList.contains("active") }));
    const screens = document.querySelector('.anno-panel[data-panel="screens"]');
    const pad = (n) => String(n).padStart(2, "0");
    const local = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
    const shots = (require("./state.js").getSession().events || []).filter((e) => e.type === "system" &&
      (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
    const stamps = [...document.querySelectorAll("#screenshots-grid .thumb .stamp")].map((s) => s.textContent);
    return {
      tabs,
      screensShown: !!(screens && getComputedStyle(screens).display !== "none"),
      notesGone: document.querySelectorAll('.anno-tab[data-anno="notes"], .anno-panel[data-panel="notes"], #anno-note, #btn-save-note, #annotations-list, #lanes-popup input[data-lane="notes"]').length === 0,
      overlayGone: !document.getElementById("shortcuts-overlay") && !document.querySelector(".kbd-hint"),
      stamps, localStamps: shots.map((e) => local(e.timestamp)),
      utcStamps: shots.map((e) => String(e.timestamp).slice(11, 19)),
      offsetMin: new Date(shots.length ? shots[0].timestamp : Date.now()).getTimezoneOffset(),
    };
  }).catch((e) => ({ err: e.message }));
  const panelOk = !!(sidePanel && !sidePanel.err &&
    JSON.stringify(sidePanel.tabs) === JSON.stringify([{ anno: "screens", active: true }, { anno: "markers", active: false }]) &&
    sidePanel.screensShown && sidePanel.notesGone && sidePanel.overlayGone);
  record("P1.6 (AD-17) + P1.1: Flow's side panel opens on Screenshots next to Markers; no Notes tab, note field or note lane; no shortcuts overlay",
    panelOk, JSON.stringify(sidePanel && { tabs: sidePanel.tabs, screensShown: sidePanel.screensShown,
      notesGone: sidePanel.notesGone, overlayGone: sidePanel.overlayGone, err: sidePanel.err }));
  const stampsOk = !!(sidePanel && !sidePanel.err && sidePanel.stamps.length > 0 &&
    JSON.stringify(sidePanel.stamps) === JSON.stringify(sidePanel.localStamps) &&
    (sidePanel.offsetMin === 0 || sidePanel.stamps.every((s, i) => s !== sidePanel.utcStamps[i])));
  record("F4: the screenshot thumbnails show local time, the timeline's clock (not the UTC slice of the timestamp)",
    stampsOk, JSON.stringify(sidePanel && { stamps: sidePanel.stamps, local: sidePanel.localStamps, utc: sidePanel.utcStamps,
      utcOffsetMinutes: sidePanel && -sidePanel.offsetMin }) +
      (sidePanel && sidePanel.offsetMin === 0 ? " (UTC machine: local equals UTC here)" : ""));
  if (!(panelOk && stampsOk)) await shot(page, "fail-flow-side-panel.png");

  // --- P2.1 / P2.8 / P2.11: the More menu without a video -------------------
  // Attach video, the transcript item and the two dialogs Steps used to carry;
  // no Build process map switch (the map is always built); Sync video and
  // Flow's + Step show only once a video is linked (checked with one below).
  const moreMenu = async () => {
    await page.locator("#btn-session-more-menu").click({ timeout: STATE_TIMEOUT });
    const items = await page.evaluate(() => [...document.querySelectorAll("#session-more-popup > *")]
      .filter((el) => getComputedStyle(el).display !== "none").map((el) => el.id || (el.textContent || "").trim()));
    await page.locator("#btn-session-more-menu").click({ timeout: STATE_TIMEOUT });
    return items;
  };
  let moreNoVideo = null, addStepNoVideo = null;
  try {
    moreNoVideo = await moreMenu();
    addStepNoVideo = await page.evaluate(() => {
      const b = document.getElementById("btn-add-step");
      return !!(b && getComputedStyle(b).display !== "none");
    });
  } catch (e) { logActionError("More menu", e); moreNoVideo = ["error: " + String(e.message).split("\n")[0]]; }
  const WANT_MORE = ["btn-attach-video", "btn-attach-transcript", "btn-ignored-apps", "btn-remembered-names"];
  const moreOk = JSON.stringify(moreNoVideo) === JSON.stringify(WANT_MORE) && addStepNoVideo === false &&
    !(await page.$("#cb-mine")) && !(await page.$("#session-layout-steps #btn-ignored-apps, #session-layout-steps #btn-remembered-names"));
  record("P2.1 + P2.8 + P2.11: without a video, More lists Attach video, Attach transcript, Ignored apps and Remembered names (no Sync video, no Build process map), and Flow has no + Step",
    moreOk, JSON.stringify({ more: moreNoVideo, addStepShown: addStepNoVideo }));

  // --- P2.10: the Raw events drawer is Flow's only ---------------------------
  // The machine layer shows on Flow and nowhere else; opened there, it sits
  // below the Flow layout (the page grows, nothing is painted over).
  const drawerShown = () => page.evaluate(() => {
    const d = document.querySelector(".event-table-host");
    return !!(d && getComputedStyle(d).display !== "none");
  });
  const drawerOn = {};
  for (const lvl of ["overview", "steps", "map", "flow"]) {
    await page.locator('.view-mode-btn[data-level="' + lvl + '"]').click({ timeout: STATE_TIMEOUT }).catch(() => {});
    await wait(500);
    drawerOn[lvl] = await drawerShown();
  }
  const summary = await page.$(".event-table-host > summary");
  if (summary) {
    await summary.scrollIntoViewIfNeeded().catch(() => {});
    await summary.click().catch((e) => console.log("rawevents open", e.message));
    await wait(900);
  }
  const flowGeom = await page.evaluate(() => {
    const d = document.querySelector(".event-table-host");
    const flow = document.getElementById("session-layout-flow");
    if (!d || !flow) return null;
    return { open: d.open, flowBottom: Math.round(flow.getBoundingClientRect().bottom), rawTop: Math.round(d.getBoundingClientRect().top) };
  }).catch((e) => ({ err: e.message }));
  const drawerOk = !!(drawerOn.flow && !drawerOn.overview && !drawerOn.steps && !drawerOn.map &&
    flowGeom && !flowGeom.err && flowGeom.open && flowGeom.flowBottom <= flowGeom.rawTop);
  record("P2.10: the Raw events drawer shows on Flow only; opened there it sits below the Flow layout",
    drawerOk, JSON.stringify({ shownOn: drawerOn, flowGeom }));
  if (!drawerOk) await shot(page, "fail-raw-events-flow-only.png");
  const mapBtn = await page.$('.view-mode-btn[data-level="map"]');

  // --- The one map: the connectivity pin (moved from the screen grain) -------
  // The Map shows one Flow diagram built from the runs' steps: a node per step
  // (a drafted step's name, else its value-free process_label), an edge per two
  // consecutive steps of a run. The headline regression this pins: node keys
  // that carry case values (an order #, a record id) put every run on an island
  // of its own, so the map fans out. On the demo (4 runs) the map must be ONE
  // weakly-connected component with one entry step (no incoming path) and one
  // final step (no outgoing path). The run endings are reported alongside: a
  // run may end early (the demo's third run ends at the Excel step the other
  // runs pass through), so "one final step" is a property of the graph, not a
  // claim that every run ends in the same place. We drive the live cytoscape
  // graph (dfg-viewer exposes host.__cy). P2.3: every path is drawn (no
  // filter can hide the branches the PDD needs): the drawn edges are exactly
  // the runs' edges.
  if (mapBtn) { await mapBtn.click().catch(() => {}); await wait(1200); }
  const connProbe = await page.evaluate(() => {
    const host = document.getElementById("session-map-dfg-host");
    const cy = host && host.__cy;
    if (!cy) return { rendered: false, text: host ? (host.textContent || "").slice(0, 200) : null };
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
      sources: sourceIds.length, sinks: sinkIds.length, sourceIds, sinkIds,
      runEndings: cy.nodes().filter((n) => n.data("role") === "end").map((n) => n.id()),
      runEdges: (() => {
        const s = require("./state.js").getSession();
        const runs = require("./runs-model.js").buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
        return require("./process-map-levels.js").buildAnnotationDfg(runs.map((r) => r.visible)).edges.length;
      })(),
      filterControls: document.querySelectorAll("#session-rng-rare, #session-hide-rare-wrap, #session-map-zoom-pct").length,
      leftToRight: srcLeftmost && sinkRightmost && bb.w >= bb.h,
      aspect: Math.round((bb.w / Math.max(1, bb.h)) * 10) / 10,
    };
  }).catch((e) => ({ err: e.message }));
  if (connProbe && connProbe.err) {
    record("the process map is one connected graph", false, "probe error: " + connProbe.err);
  } else if (!connProbe.rendered) {
    record("the process map is one connected graph (1 component, 1 entry step, 1 final step)", false,
      "no map drawn: " + JSON.stringify(connProbe));
    await shot(page, "fail-map-connectivity.png");
  } else {
    const ok = connProbe.components === 1 && connProbe.sources === 1 && connProbe.sinks === 1 &&
      connProbe.edges === connProbe.runEdges && connProbe.filterControls === 0;
    record("the process map is one connected graph (1 component, 1 entry step, 1 final step), every path drawn", ok,
      "nodes=" + connProbe.nodes + " edges=" + connProbe.edges + "/" + connProbe.runEdges + " components=" + connProbe.components +
      " filterControls=" + connProbe.filterControls +
      " sources=" + JSON.stringify(connProbe.sourceIds) + " sinks=" + JSON.stringify(connProbe.sinkIds) +
      " runEndings=" + JSON.stringify(connProbe.runEndings) + " (a value in the node key would split the runs into islands)");
    if (!ok) await shot(page, "fail-map-connectivity.png");

    // Layout readability: dagre LR (source leftmost, sink rightmost, wider-than-tall),
    // NOT the radial breadthfirst hub that appears when dagre isn't wired up.
    record("the process map reads left-to-right (dagre LR, not a radial hub)",
      connProbe.leftToRight,
      "leftToRight=" + connProbe.leftToRight + " aspect(w/h)=" + connProbe.aspect +
      " (radial fallback would put aspect ~1 and break source-leftmost/sink-rightmost)");
    if (!connProbe.leftToRight) await shot(page, "fail-map-radial.png");
  }

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
  record("AD-11: Export > Process map (image), with no As-Is copy chosen, opens the Map from the Overview and writes the shown map as an SVG file",
    svgOk, "bytes=" + svgRes.bytes + " suggested=" + svgRes.suggested + " onMap=" + svgLanded + " head=" + JSON.stringify(svgRes.head.slice(0, 80)));
  if (!svgOk) await shot(page, "fail-export-map-svg.png");
  if (!FRESH) {
    record("AD-11: Export > Process map (BPMN) (skipped: session not re-normalized)", true,
      "the export would analyze into the committed demo folder");
  } else {
    const bpmnOut = path.join(os.tmpdir(), "pdt-e2e-step-" + Date.now() + ".bpmn");
    const bpmnRes = await exportViaMenu("btn-session-step-bpmn", bpmnOut);
    const bpmnOk = bpmnRes.bytes > 0 && /<(?:[\w-]+:)?definitions[\s>]/.test(bpmnRes.text) &&
      /<(?:[\w-]+:)?(?:task|userTask)[\s>]/.test(bpmnRes.text) && /\.bpmn$/.test(bpmnRes.suggested || "");
    record("AD-11: Export > Process map (BPMN), with no As-Is copy chosen, writes the step-level BPMN file",
      bpmnOk, "bytes=" + bpmnRes.bytes + " suggested=" + bpmnRes.suggested + " head=" + JSON.stringify(bpmnRes.head.slice(0, 80)));
    if (!bpmnOk) await shot(page, "fail-export-step-bpmn.png");
  }

  // --- ADR-0019 Reference Maps round-trip pin ---------------------------------
  // An edited map is a decoupled, editable BPMN copy of the process map. The
  // honest-leaf contract has a full lifecycle: the Map's one act (it analyzes
  // first when the steps changed, then copies; the copy is a one-way leaf) ->
  // Edit (full bpmn-js palette) -> Save (debounced saveXML to
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
    // P1.7 + P2.16: the step detail shows what the analyst edits and what the
    // PDD prints: one fact line (no Start, End or Run tiles, no drafting
    // reason), the Description resident (not behind More), and the step's own
    // screenshots, stamped in local time.
    const detail = {};
    try {
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: STATE_TIMEOUT });
      await page.waitForSelector("#step-list .run-group.open .step-row", { timeout: STATE_TIMEOUT });
      detail.stepId = await page.evaluate(() => {
        const s = require("./state.js").getSession();
        const byId = Object.fromEntries(((s.annotations || {}).steps || []).map((x) => [x.step_id, x]));
        const rows = [...document.querySelectorAll("#step-list .run-group.open .step-row")].map((r) => r.dataset.stepId);
        return rows.find((id) => (((byId[id] || {}).evidence || {}).screenshot_refs || []).length > 0) || null;
      });
      if (!detail.stepId) throw new Error("no step with screenshots in the open run");
      await page.locator('#step-list .step-row[data-step-id="' + detail.stepId + '"]').click({ timeout: STATE_TIMEOUT });
      await page.waitForSelector("#step-detail .step-shot img", { timeout: STATE_TIMEOUT });
      await page.waitForFunction(() => [...document.querySelectorAll("#step-detail .step-shot img")].every((i) => i.complete),
        null, { timeout: STATE_TIMEOUT });
      Object.assign(detail, await page.evaluate((sid) => {
        const s = require("./state.js").getSession();
        const step = ((s.annotations || {}).steps || []).find((x) => x.step_id === sid);
        const pad = (n) => String(n).padStart(2, "0");
        const local = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
        const at = {};
        for (const e of s.events || []) if (e.type === "system" && e.data && e.data.path) at[e.data.path] = e.timestamp;
        const more = document.querySelector("#step-detail .step-detail-more");
        const desc = document.getElementById("step-desc");
        return {
          fact: ((document.querySelector("#step-detail .step-fact") || {}).textContent || "").trim(),
          tiles: document.querySelectorAll("#step-detail .stat-tile, #step-detail .step-suggestion-reason").length,
          descResident: !!(desc && more && !more.contains(desc) && getComputedStyle(desc).display !== "none"),
          refs: (step.evidence.screenshot_refs || []).length,
          shots: [...document.querySelectorAll("#step-detail .step-shot")].map((b) => ({
            ref: b.dataset.ref, loaded: (b.querySelector("img") || {}).naturalWidth > 0,
            stamp: ((b.querySelector(".stamp") || {}).textContent || "").trim() })),
          wantStamps: (step.evidence.screenshot_refs || []).map((r) => (at[r] ? local(at[r]) : "")),
          // The draft's why, short, from the pipeline's reason (the step is a
          // draft that ended at a commit in the demo).
          wantWhy: (() => {
            const r = /^Drafted from (\d+) interactions? on (.+?); ended at the commit "(.+)"\.$/.exec(step.suggestion_reason || "");
            return step.end_reason === "commit" && r ? r[1] + " interaction" + (r[1] === "1" ? "" : "s") + " on " + r[2] + ", ended at " + r[3] : null;
          })(),
        };
      }, detail.stepId));
    } catch (e) { logActionError("P1.7 + P2.16 step detail", e); detail.err = String(e.message).split("\n")[0]; }
    const detailOk = !!(!detail.err && /^\d+(s|:\d{2}) · \S/.test(detail.fact || "") && detail.tiles === 0 && detail.descResident &&
      detail.wantWhy && (detail.fact || "").endsWith(" · " + detail.wantWhy) &&
      detail.shots && detail.shots.length === detail.refs && detail.refs > 0 && detail.shots.every((x) => x.loaded) &&
      JSON.stringify(detail.shots.map((x) => x.stamp)) === JSON.stringify(detail.wantStamps));
    record("P1.7 + P2.16: the step detail shows one fact line ending in the draft's why (its interactions on the screen, ended at its commit), the Description resident, and the step's own screenshots (loaded, in local time); no Start, End or Run tiles",
      detailOk, JSON.stringify(detail));
    if (!detailOk) await shot(page, "fail-step-detail.png");

    const PROBE = "RT_PIN_EDIT"; // a label no mined node carries
    const stepBpmn = path.join(SESSION, "process_map_step.bpmn");
    // F1 + AD-19: the Map's one act makes the As-Is map from the step names as
    // they are now. A pattern-run draft is renamed in Steps first (the
    // analyst's verb, the detail form), so the steps are newer than the map's
    // BPMN file: the act must analyze first (busy meanwhile), and the copy
    // must carry the new name, not the draft's.
    const RENAMED = "Look up the customer";
    const OLD = "Salesforce - Account lookup: Search";
    const f1 = {};
    try {
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: STATE_TIMEOUT });
      await page.waitForSelector("#step-list .run-group.pattern", { timeout: STATE_TIMEOUT });
      // "Open in Steps" above left run 4 open: open the pattern run.
      if (!(await page.$("#step-list .run-group.pattern.open"))) {
        await page.locator("#step-list .run-group.pattern > .run-row").click({ timeout: STATE_TIMEOUT });
      }
      await page.waitForSelector("#step-list .run-group.pattern.open .step-row", { timeout: STATE_TIMEOUT });
      await page.locator("#step-list .run-group.pattern.open .step-row", { hasText: OLD }).first().click({ timeout: STATE_TIMEOUT });
      await page.locator("#step-name").fill(RENAMED, { timeout: STATE_TIMEOUT });
      await page.locator("#btn-step-save").click({ timeout: STATE_TIMEOUT });
      await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")]
        .some((e) => e.textContent.trim() === n), RENAMED, { timeout: STATE_TIMEOUT });
      f1.bpmnHadOld = fs.readFileSync(stepBpmn, "utf-8").includes(OLD);
      f1.annoNewer = fs.statSync(path.join(SESSION, "annotations.json")).mtimeMs > fs.statSync(stepBpmn).mtimeMs;
      await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: STATE_TIMEOUT });
      await wait(700);
      f1.button = await page.evaluate(() => {
        const b = document.getElementById("btn-fork-refmap");
        return { text: (b.textContent || "").trim(), primary: b.classList.contains("primary") };
      });
      await page.locator("#btn-fork-refmap").click({ timeout: STATE_TIMEOUT });
      f1.busy = await page.waitForFunction(() => {
        const b = document.getElementById("btn-fork-refmap");
        return b.getAttribute("aria-busy") === "true" && b.disabled && /Updating/.test(b.textContent || "");
      }, null, { timeout: 5000 }).then(() => true, () => false);
      await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
      await wait(900);
    } catch (e) { logActionError("F1 rename, then the Map's edit act", e); f1.err = String(e.message).split("\n")[0]; }
    // The act's analysis rewrote the map's file; from here on nothing may
    // touch it (the one-way leaf check below).
    const stepXml = fs.existsSync(stepBpmn) ? fs.readFileSync(stepBpmn, "utf-8") : null;
    const minedBefore = stepXml != null ? fs.statSync(stepBpmn).size + ":" + stepXml.length : null;
    const forked = await page.evaluate((a) => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      const s = State.getSession(), e = RM.list(s.annotations)[0] || null;
      const host = document.getElementById("refmap-editor-host");
      const overlay = document.getElementById("refmap-editor-overlay");
      const palette = host && host.querySelector(".djs-palette");
      const xml = e ? RM.readBpmn(s.sessionFolder, e) : null;
      return {
        count: RM.list(s.annotations).length,
        fileOnDisk: e ? RM.fileExists(s.sessionFolder, e) : false,
        copyOfStepBpmn: !!(e && a.src != null && xml === a.src),
        sourceLevel: e && e.source ? e.source.level : null,
        hasHash: !!(e && e.forked_from_hash),
        name: e && e.name, pddRole: e && e.pdd_role,
        editorPdd: (document.getElementById("refmap-editor-pdd") || {}).value,
        editorControls: ["refmap-editor-kind", "refmap-editor-badge", "refmap-editor-prov"].filter((id) => document.getElementById(id)),
        newName: !!(xml && xml.includes(a.renamed)), oldName: !!(xml && xml.includes(a.old)),
        editorOpen: !!(overlay && overlay.style.display !== "none"),
        editorSvg: !!(host && host.querySelector("svg")),
        paletteVisible: palette ? getComputedStyle(palette).display !== "none" : false,
      };
    }, { src: stepXml, renamed: RENAMED, old: OLD }).catch((e) => ({ err: e.message }));
    const forkOk = !!(forked && !forked.err && forked.count === 1 && forked.fileOnDisk && forked.copyOfStepBpmn &&
      forked.sourceLevel === "step" && forked.hasHash && forked.editorOpen && forked.editorSvg && forked.paletteVisible &&
      forked.name === "As-Is map" && forked.pddRole === "as_is" && forked.editorPdd === "as_is" &&
      forked.editorControls.length === 0 && f1.button && f1.button.text === "Edit as the As-Is map" && f1.button.primary);
    record("AD-19 + P1.12: the Map's one act, Edit as the As-Is map, copies the process map into the editor as the PDD's As-Is map (one role control)",
      forkOk, JSON.stringify({ button: f1.button, forked }));
    const f1Ok = !!(!f1.err && f1.bpmnHadOld && f1.annoNewer && f1.busy && forked && forked.newName && !forked.oldName);
    record("F1: after a rename the act analyzes first (the button busy meanwhile), and the copy's BPMN carries the new step name, not the draft's",
      f1Ok, JSON.stringify({ err: f1.err, bpmnHadOld: f1.bpmnHadOld, annoNewer: f1.annoNewer, busy: f1.busy,
        newName: forked && forked.newName, oldName: forked && forked.oldName }));
    if (!(forkOk && f1Ok)) await shot(page, "fail-refmap-fork.png");

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

    // Reload: close + reopen the editor from the gallery row (re-reads the
    // blob) -> the edit survives. The gallery is open after a fork; the reopen
    // must really happen (the editor closes, then shows again), or the check
    // would read the closed editor's diagram.
    const overlayShown = () => page.evaluate(() => {
      const o = document.getElementById("refmap-editor-overlay");
      return !!(o && o.style.display !== "none");
    });
    await page.click("#btn-refmap-editor-close", { timeout: 2500 }).catch(() => {});
    await wait(700);
    const closedAfterEdit = !(await overlayShown());
    const galleryShown = await page.evaluate(() => {
      const p = document.getElementById("refmap-panel");
      return !!(p && getComputedStyle(p).display !== "none");
    });
    if (!galleryShown) await page.click("#btn-toggle-refmaps").catch(() => {});
    await page.click('#refmap-list [data-rm-act="edit"]', { timeout: 5000 }).catch((e) => console.log("reopen", e.message));
    await wait(1400);
    const reopened = await overlayShown();
    const reloadedHasEdit = await page.evaluate(async (probe) => {
      let xml = null;
      try { xml = await require("./bpmn-viewer.js").exportXml(); } catch (_) {}
      return !!(xml && xml.indexOf(probe) !== -1);
    }, PROBE).catch(() => false);
    await page.click("#btn-refmap-editor-close", { timeout: 2500 }).catch(() => {});
    await wait(500);
    const rtOk = edited.ok && savedToDisk && closedAfterEdit && reopened && reloadedHasEdit;
    const actAfter = await page.evaluate(() => {
      const b = document.getElementById("btn-fork-refmap");
      return { text: (b.textContent || "").trim(), primary: b.classList.contains("primary") };
    }).catch((e) => ({ err: e.message }));
    record("P1.12: once the As-Is map exists the act reads Edit a new copy and is no longer the orange next act",
      !!(actAfter && actAfter.text === "Edit a new copy" && actAfter.primary === false), JSON.stringify(actAfter));
    record("reference map: Edit -> Save -> reload round-trips the edit", rtOk,
      "edit=" + edited.ok + " savedToDisk=" + savedToDisk + " closed=" + closedAfterEdit +
      " reopenedFromGallery=" + reopened + " reloadedHasEdit=" + reloadedHasEdit +
      (edited.why ? " (" + edited.why + ")" : ""));
    if (!rtOk) await shot(page, "fail-refmap-roundtrip.png");

    // Label legibility: the row/toolbar buttons carry multi-word TEXT (Edit /
    // Duplicate / Delete; the Map's act; Edited maps) and once reused the shared
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
    // F3: the gallery's Delete was dark orange text on a red fill at rest. Its
    // label must clear 4.5:1 against what it sits on.
    const delLegible = await page.evaluate(() => {
      const b = document.querySelector('#refmap-list [data-rm-act="del"]');
      if (!b) return { found: false };
      const rgb = (c) => (String(c).match(/[\d.]+/g) || []).map(Number);
      const lum = (v) => {
        const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
      };
      let bg = null;
      for (let el = b; el && !bg; el = el.parentElement) {
        const v = rgb(getComputedStyle(el).backgroundColor);
        if (v.length >= 3 && (v.length < 4 || v[3] > 0)) bg = v;
      }
      const fg = rgb(getComputedStyle(b).color);
      const l1 = lum(fg), l2 = lum(bg || [255, 255, 255]);
      return { found: true, color: fg.join(","), background: (bg || []).join(","),
        ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 };
    }).catch((e) => ({ err: e.message }));
    record("F3: the gallery's Delete label is legible at rest (at least 4.5:1)",
      !!(delLegible && delLegible.found && delLegible.ratio >= 4.5), JSON.stringify(delLegible));

    // CI-3: the gallery stays clickable while Raw events is open. Opening Raw
    // events used to freeze the Map layout at a fixed height, so the gallery
    // opened later was squeezed and its buttons sat under the drawer's summary,
    // which took the clicks. P2.10: the drawer is Flow's only, so here it is
    // left open on Flow (the P2.10 check above opened it) and hidden on the
    // Map. A trial click runs Playwright's full actionability check (visible,
    // stable, and the button itself receives the pointer) without clicking.
    const galleryReach = await page.evaluate(() => {
      const d = document.querySelector(".event-table-host");
      return { drawerOpen: !!(d && d.open), drawerHiddenOnMap: !!(d && getComputedStyle(d).display === "none") };
    });
    {
      const btns = page.locator("#refmap-list [data-rm-act]");
      const n = await btns.count();
      const blocked = [];
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const act = await b.getAttribute("data-rm-act");
        await b.click({ trial: true, timeout: 5000 })
          .catch((e) => { logActionError("CI-3 gallery " + act, e); blocked.push(act + ": " + String(e.message).split("\n")[0]); });
      }
      Object.assign(galleryReach, { buttons: n, blocked });
    }
    const reachOk = galleryReach.drawerOpen && galleryReach.drawerHiddenOnMap && galleryReach.buttons > 0 &&
      galleryReach.blocked.length === 0;
    record("CI-3 + P2.10: with Raw events left open on Flow (hidden on the Map), every gallery button is clickable",
      reachOk, JSON.stringify(galleryReach));
    if (!reachOk) await shot(page, "fail-refmap-gallery-reach.png");

    // Item 2 fix: the "Edited maps" toggle is its own inverse: a shown
    // gallery hides on a click and shows again on the next (it used to stay shown).
    const galleryState = () => page.evaluate(() => {
      const p = document.getElementById("refmap-panel");
      const t = document.getElementById("btn-toggle-refmaps");
      return { shown: !!(p && getComputedStyle(p).display !== "none"), expanded: t ? t.getAttribute("aria-expanded") : null };
    });
    const g0 = await galleryState();
    await page.click("#btn-toggle-refmaps").catch((e) => console.log("toggle", e.message));
    const g1 = await galleryState();
    await page.click("#btn-toggle-refmaps").catch((e) => console.log("toggle", e.message));
    const g2 = await galleryState();
    record("item 2: the Edited maps toggle hides a shown gallery and shows it again",
      !!(g0.shown && !g1.shown && g1.expanded === "false" && g2.shown && g2.expanded === "true"),
      JSON.stringify({ before: g0, afterFirst: g1, afterSecond: g2 }));
    if (!g2.shown) await page.click("#btn-toggle-refmaps").catch(() => {});   // leave it open, as found

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

    // Decoupled leaf: after the act's own analysis, nothing above touched the
    // step-level BPMN on disk.
    const minedAfter = fs.existsSync(stepBpmn)
      ? fs.statSync(stepBpmn).size + ":" + fs.readFileSync(stepBpmn, "utf-8").length : null;
    record("reference map: the step-level BPMN it was forked from is untouched (one-way leaf)",
      minedBefore != null && minedBefore === minedAfter,
      "before=" + minedBefore + " after=" + minedAfter);

  }

  // --- L5b: a timeline menu opened at the window's edge stays inside it ------
  // On a 1366x768 window the open Session summary pushes Flow down, so the
  // timeline shows only as a strip at the bottom edge; a menu opened there at
  // the raw click point put its items below the window edge (and at the
  // timeline's right end, past the right edge), where no scrolling reaches a
  // fixed menu. Scroll the view so only the timeline's top 40 px show at the
  // bottom edge, as far as the page allows (at 1500x950 the page above Flow is
  // too short, so there only the right edge is exercised), open the timeline
  // menu 3 px inside the bottom right corner of what shows (the real
  // contextmenu handler, dispatched at that point as item 6 does), and require
  // the whole menu inside the window with every item clickable (a trial click
  // runs Playwright's full actionability check).
  const edgeMenu = { blocked: [] };
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: STATE_TIMEOUT });
    await page.waitForSelector("#timeline .tl-band", { state: "visible", timeout: STATE_TIMEOUT });
    edgeMenu.point = await page.evaluate(() => {
      const tl = document.getElementById("timeline");
      const view = document.getElementById("view-session");
      view.scrollTop += tl.getBoundingClientRect().top - (innerHeight - 40);
      const r = tl.getBoundingClientRect();
      const shown = document.getElementById("timeline-scroll").getBoundingClientRect();
      const x = Math.min(r.right, shown.right, innerWidth) - 3;
      const y = Math.min(r.bottom, shown.bottom, innerHeight) - 3;
      const onTimeline = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && y >= 0;
      if (onTimeline) tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return { x: Math.round(x), y: Math.round(y), onTimeline, window: innerWidth + "x" + innerHeight };
    });
    if (!edgeMenu.point.onTimeline) throw new Error("the right-click point is not on the visible timeline");
    await page.waitForSelector("#tl-ctx-menu", { state: "visible", timeout: STATE_TIMEOUT });
    edgeMenu.menu = await page.evaluate(() => {
      const b = document.getElementById("tl-ctx-menu").getBoundingClientRect();
      return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom),
        inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight };
    });
    const items = page.locator("#tl-ctx-menu > div");
    edgeMenu.items = await items.count();
    for (let i = 0; i < edgeMenu.items; i++) {
      await items.nth(i).click({ trial: true, timeout: 5000 }).catch((e) => {
        logActionError("L5b edge menu item " + i, e);
        edgeMenu.blocked.push(i + ": " + String(e.message).split("\n")[0]);
      });
    }
  } catch (e) {
    logActionError("L5b edge menu", e);
    edgeMenu.err = String(e.message).split("\n")[0];
  }
  await page.keyboard.press("Escape").catch(() => {});   // close it: leave the view as found
  edgeMenu.closed = await page.waitForSelector("#tl-ctx-menu", { state: "detached", timeout: 5000 })
    .then(() => true, () => false);
  const edgeOk = !!(!edgeMenu.err && edgeMenu.menu && edgeMenu.menu.inside && edgeMenu.items >= 2 &&
    edgeMenu.blocked.length === 0 && edgeMenu.closed);
  record("L5b: the timeline menu opened at the window's edge stays inside the window, every item clickable",
    edgeOk, JSON.stringify(edgeMenu));
  if (!edgeOk) await shot(page, "fail-edge-menu.png");

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
      runsLine: ((document.querySelector('#ov-summary [data-summary="runs"]') || {}).textContent || "").trim(),
      stepsRuns: document.querySelectorAll("#step-list .run-group").length,
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
      // L5b: the analyst can only right-click the timeline where it is on
      // screen. On a 768 px tall window the open Session summary pushes Flow
      // below the fold, so first scroll the timeline into view the way the
      // analyst scrolls the page; the right-click point must then be on
      // screen (it used to be dispatched below the window's bottom edge, which
      // put the menu off screen: the CI-only "locator.click: Timeout").
      await page.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
      const at = await page.evaluate((iso) => {
        const tl = document.getElementById("timeline");
        const evs = require("./state.js").getSession().events;
        const first = new Date(evs[0].timestamp).getTime();
        const last = new Date(evs[evs.length - 1].timestamp).getTime();
        const r = tl.getBoundingClientRect();
        const x = r.left + ((new Date(iso).getTime() - first) / (last - first)) * r.width;
        const y = r.top + 4;
        const onScreen = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
        if (onScreen) tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        return { onScreen, x: Math.round(x), y: Math.round(y), window: innerWidth + "x" + innerHeight };
      }, INSERT_AT);
      if (!at.onScreen) throw new Error("the timeline point to right-click is off screen: " + JSON.stringify(at));
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
    } catch (e) { logActionError("item 6 pending marker insert", e); err = String(e.message).split("\n")[0]; }
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
      // Runs never nest (the pipeline's rule, case_assignment.py): the new run
      // has no End of its own, so the next run's Start ends it. Its band on
      // the Flow timeline ends where the next band starts, not at the end of
      // the recording.
      applied.runBand = await page.evaluate((label) => {
        const bands = [...document.querySelectorAll("#timeline .tl-case-band")]
          .map((b) => ({ title: b.title || "", dangling: b.classList.contains("dangling"), r: b.getBoundingClientRect() }))
          .sort((x, y) => x.r.left - y.r.left);
        const i = bands.findIndex((b) => b.title.includes(label));
        if (i < 0) return null;
        const next = bands[i + 1] || null;
        return { dangling: bands[i].dangling, top: Math.round(bands[i].r.top), right: Math.round(bands[i].r.right),
          nextLeft: next ? Math.round(next.r.left) : null, nextTop: next ? Math.round(next.r.top) : null };
      }, LABEL);
    } catch (e) { logActionError("item 6 Analyze to apply", e); err = String(e.message).split("\n")[0]; }
    const appliedOk = !!(applied && before && applied.row && !applied.row.pending && applied.row.inserted &&
      applied.pendingBars === 0 && applied.cta === null &&
      applied.cases.analyzed === before.analyzed + 1 && applied.cases.bands === before.bands + 1 &&
      // The Overview names the runs the Steps level lists; both follow the new
      // analysis.
      applied.cases.runsLine === applied.cases.stepsRuns + " runs" &&
      before.runsLine === before.stepsRuns + " runs");
    record("item 6: its call to action runs Analyze; the marker becomes a real one and the case count goes up by one",
      appliedOk, JSON.stringify({ before: before && before.analyzed, applied, err }));
    const rb = applied && applied.runBand;
    record("runs never nest on the timeline: the inserted run's band ends where the next run starts, on the same row (the pipeline's rule)",
      !!(rb && !rb.dangling && rb.nextLeft != null && Math.abs(rb.right - rb.nextLeft) <= 2 && rb.top === rb.nextTop),
      JSON.stringify(rb));
    if (!appliedOk) await shot(page, "fail-marker-applied.png");
  }

  // --- P2.11: Sync video and + Step come with a video ------------------------
  // A copy of the analyzed session with a video linked (annotations
  // external_video: any existing file, the check is the controls, not
  // playback), opened in the same viewer: More offers Sync video and Flow
  // offers + Step. Opened again without it, both go.
  if (FRESH) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-e2e-video-"));
    for (const f of fs.readdirSync(SESSION)) {
      const src = path.join(SESSION, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dir, f));
    }
    const video = path.join(dir, "call-recording.mp4");
    fs.writeFileSync(video, Buffer.alloc(64));
    const annoPath = path.join(dir, "annotations.json");
    const anno = JSON.parse(fs.readFileSync(annoPath, "utf-8"));
    anno.external_video = { path: video, offset_ms: 0 };
    fs.writeFileSync(annoPath, JSON.stringify(anno, null, 2));
    const vid = {};
    try {
      await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), dir);
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: STATE_TIMEOUT });
      vid.recording = await page.evaluate(() => !!require("./state.js").getSession().recordingAvailable);
      vid.more = await moreMenu();
      vid.addStep = await page.evaluate(() => {
        const b = document.getElementById("btn-add-step");
        return !!(b && getComputedStyle(b).display !== "none");
      });
      await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), SESSION);
      vid.moreAfter = await moreMenu();
      vid.addStepAfter = await page.evaluate(() => {
        const b = document.getElementById("btn-add-step");
        return !!(b && getComputedStyle(b).display !== "none");
      });
    } catch (e) { logActionError("P2.11 with a video", e); vid.err = String(e.message).split("\n")[0]; }
    const WITH_VIDEO = ["btn-attach-video", "btn-sync-video", "btn-attach-transcript", "btn-ignored-apps", "btn-remembered-names"];
    record("P2.11: with a video linked, More offers Sync video and Flow offers + Step; without one again, both go",
      !!(!vid.err && vid.recording && JSON.stringify(vid.more) === JSON.stringify(WITH_VIDEO) && vid.addStep &&
        JSON.stringify(vid.moreAfter) === JSON.stringify(WANT_MORE) && vid.addStepAfter === false),
      JSON.stringify(vid));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
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
