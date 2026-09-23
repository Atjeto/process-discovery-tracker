"use strict";
/*
 * Overview e2e smoke: the home of a loaded session (BA-helper cycle).
 *
 * Launches the REAL viewer twice and asserts the Overview end to end:
 *   (a) the DEFAULT level is Overview (#session-layout-overview visible,
 *       its view-mode button active, the Flow layout hidden), laid out at its
 *       full height (the Session view scrolls; L5b small-screen fix);
 *   (b) the home leads with the "What is left" line (one button), the
 *       one-line session summary and, right under it, the document sections;
 *       the fact tiles, the badge, the separate mark-runs line and the export
 *       bar are gone, and the run count is said once;
 *   (c) the findings feed (methodology once per group, expand-in-place
 *       evidence, no repeated-sequence group: AD-20) and the Evidence modules
 *       (collapsed to their takeaway lines); F2: the "include in PDD" boxes
 *       show the PDD's default findings ticked, unticking one stores the
 *       others, unticking the last returns to the default with one toast
 *       line, and the exported PDD prints no finding (its findings section
 *       is cut, lane LUX-P);
 *   (d) the analyst path, walked on the demo: every next act lands where it
 *       says (the pattern run open in Steps, each other run open in Steps,
 *       the document sections open on their first empty field, the Map), a
 *       done stage shows done, a document field saves undoably, and the last
 *       act exports the PDD, whose word/document.xml carries the Purpose the
 *       analyst wrote (contract C6, end to end) and the As-Is and To-Be maps
 *       chosen in the reference-map gallery; the Export menu's map items then
 *       save the As-Is copy chosen for the PDD (P2.12);
 *   (e) on a marker-STRIPPED re-normalized copy the line says no runs are
 *       marked, and its button opens Flow with the Markers panel showing;
 *   (f) zero PAGE ERRORs across both launches.
 *
 * Screenshots of BOTH Overview states land in this dir (gitignored):
 *   overview-markers-state.png / overview-unsegmented-state.png.
 *
 * Like session-smoke.js it re-normalizes into TEMP copies so the committed
 * demo is never regenerated in place, and reuses the viewer's own Electron.
 * Unlike session-smoke, a missing deps-bearing Python is a HARD FAIL here:
 * every assertion depends on current pipeline output.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
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

/* Copy the demo inputs into a fresh temp session dir. `stripMarkers`
   drops every marker event from the copied events.jsonl (the way a real
   passive capture looks when the worker forgot to fire markers) and
   leaves annotations.json behind so the copy is a clean discovery
   session. Raw source files are only ever READ. */
function makeTempSession({ stripMarkers }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-e2e-"));
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

/* One entry of a .zip (a .docx is one), read with Node's zlib: the central
   directory names each entry and where its local header sits; the data is
   stored (method 0) or deflated (method 8). Returns the text, or null when
   the entry is absent. */
function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("not a zip: bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

const T = 20000;   // the bound on every wait for an observable state

(async () => {
  // ---- Prepare both sessions (hard prerequisite) --------------------------
  const SESSION_MARKED = makeTempSession({ stripMarkers: false });
  const SESSION_STRIPPED = makeTempSession({ stripMarkers: true });
  if (!normalize(SESSION_MARKED) || !normalize(SESSION_STRIPPED)) {
    record("re-normalize temp sessions (prerequisite)", false, "no deps-bearing Python");
    process.exit(1);
  }
  const ANNO = path.join(SESSION_MARKED, "annotations.json");
  const readAnno = () => JSON.parse(fs.readFileSync(ANNO, "utf-8"));

  const pageErrors = [];

  // ================= Launch 1: the marked demo (4 runs) ====================
  let app, page, close;
  try {
    ({ app, page, close } = await launch(SESSION_MARKED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (a) Default level is Overview, asserted with ZERO clicks.
  const def = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden";
    };
    const btn = document.querySelector('.view-mode-btn[data-level="overview"]');
    return {
      overviewVisible: vis("#session-layout-overview"),
      flowHidden: vis("#session-layout-flow") === false,
      btnActive: !!(btn && btn.classList.contains("active")),
      btnFirst: !!(btn && btn.parentElement &&
        btn === btn.parentElement.querySelector(".view-mode-btn")),
    };
  }).catch((e) => ({ err: e.message }));
  record("(a) default level is Overview (visible, button active+first, Flow hidden)",
    !!(def && !def.err && def.overviewVisible && def.flowHidden && def.btnActive && def.btnFirst),
    JSON.stringify(def));

  // (a2) L5b: the Overview is laid out at its full height and the Session view
  // scrolls, at every window size (it used to be squeezed by the panel above).
  const fullHeight = await page.evaluate(() => {
    const ov = document.getElementById("session-layout-overview");
    const view = document.getElementById("view-session");
    return { boxH: ov.clientHeight, contentH: ov.scrollHeight, viewScrolls: view.scrollHeight > view.clientHeight };
  }).catch((e) => ({ err: e.message }));
  record("(a2) the Overview is laid out at its full height (the Session view scrolls instead)",
    !!(fullHeight && !fullHeight.err && fullHeight.contentH > 300 && fullHeight.contentH <= fullHeight.boxH + 1),
    JSON.stringify(fullHeight));

  // (b) The home: the what-is-left line first (one button), the one-line
  // summary next; the removed surfaces are gone and nothing is said twice.
  const home = await page.evaluate(() => {
    const host = document.getElementById("overview-content");
    const kids = [...host.children].map((c) => c.id || c.className);
    const line = document.getElementById("ov-next");
    const stages = line ? [...line.querySelectorAll(".ov-next-stage")].map((li) =>
      li.dataset.stage + ":" + (li.classList.contains("done") ? "done" : li.classList.contains("next") ? "next" : "-")) : [];
    const text = host.textContent || "";
    const sum = document.querySelector("#ov-summary .ov-summary-line");
    return {
      first: kids[0], second: kids[1], third: kids[2],
      next: line ? line.dataset.next : null,
      buttons: line ? line.querySelectorAll("button").length : 0,
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
      stages,
      summary: sum ? (sum.textContent || "").trim() : null,
      summaryH: sum ? Math.round(sum.getBoundingClientRect().height) : null,
      removed: document.querySelectorAll(".ov-tile, .ov-facts, .ov-badge, #ov-mark-runs, .ov-export-bar, " +
        "#btn-ov-export-pdd, #session-summary, .ov-tier2").length,
      runsSaid: (text.match(/\b4 runs\b/g) || []).length,
      casesSaid: (text.match(/\b4 cases\b/g) || []).length,
    };
  }).catch((e) => ({ err: e.message }));
  record("(b) the home leads with the What is left line (runs done, next: the pattern run, one button), then the one-line summary, then the document sections (P1.10)",
    !!(home && !home.err && home.first === "ov-next" && home.second === "ov-summary" && home.third === "ov-doc" &&
      home.next === "pattern" &&
      home.buttons === 1 && home.button === "Confirm Run 1 in Steps" &&
      home.stages.join(",") === "runs:done,pattern:next,review:-,document:-,map:-,export:-"),
    JSON.stringify(home));
  record("(b2) the fact tiles, the badge, the mark-runs line and the export bar are gone; the summary is one line and the run count is said once",
    !!(home && !home.err && home.removed === 0 && home.summaryH > 0 && home.summaryH < 40 &&
      home.runsSaid === 1 && home.casesSaid === 0 && /^demo-order-processing · recorded by demo-worker · /.test(home.summary || "")),
    JSON.stringify(home && { removed: home.removed, summary: home.summary, summaryH: home.summaryH,
      runsSaid: home.runsSaid, casesSaid: home.casesSaid }));

  // (c) R4: the Evidence modules (retired Analysis) render below the findings,
  // collapsed to their one-line takeaways on a fresh profile (P1.10).
  const evidence = await page.evaluate(() => {
    const host = document.querySelector("#overview-content #overview-evidence");
    if (!host) return { present: false };
    const all = [...host.querySelectorAll(".analysis-module[data-module]")];
    return {
      present: true,
      modules: all.map((m) => m.getAttribute("data-module")),
      open: all.filter((m) => m.open).length,
      takeaways: all.map((m) => ((m.querySelector(".analysis-module-takeaway") || {}).textContent || "").trim()),
      captions: host.querySelectorAll(".analysis-caption").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("R4 + P1.10: Evidence modules (time / automation) render below the findings, collapsed with their takeaways showing; no ROI module, no caption",
    !!(evidence && !evidence.err && evidence.present &&
      evidence.modules.includes("time") && evidence.modules.includes("automation") &&
      !evidence.modules.includes("roi") && evidence.open === 0 && evidence.captions === 0 &&
      evidence.takeaways.every((t) => t.length > 0)),
    JSON.stringify(evidence));

  // Findings feed sanity on the demo (claims + an "include in PDD" checkbox on
  // every card; the checkbox still writes annotations.memo_selection).
  const feed = await page.evaluate(() => {
    // The Evidence host below the feed reuses the .ov-finding component for
    // automation candidate cards (no PDD checkbox): count the feed only.
    const inFeed = (el) => el.closest("#overview-evidence") === null;
    const findings = [...document.querySelectorAll("#overview-content .ov-finding")].filter(inFeed);
    const pddChecks = [...document.querySelectorAll('#overview-content [data-act="memo"]')].filter(inFeed);
    const showBtns = [...document.querySelectorAll('#overview-content [data-act="show"]')].filter(inFeed);
    const labels = pddChecks.map((c) => ((c.closest("label") || {}).textContent || "").trim());
    return {
      findings: findings.length, pddChecks: pddChecks.length, showBtns: showBtns.length,
      allSayPdd: labels.length > 0 && labels.every((t) => t === "include in PDD"),
      firstLabel: labels[0] || null,
    };
  }).catch((e) => ({ err: e.message }));
  record("findings feed renders with an 'include in PDD' checkbox on every finding",
    !!(feed && !feed.err && feed.findings > 0 && feed.pddChecks === feed.findings && feed.allSayPdd),
    JSON.stringify(feed));

  // F2 + AD-20: the "include in PDD" boxes show exactly what the PDD prints.
  // With nothing ticked they show the PDD's default findings, the ids the
  // pipeline wrote into analysis.json from the PDD's own selection; the feed
  // holds the printable findings, and a repeated step sequence is not one.
  const feedState = () => page.evaluate(() => {
    const inFeed = (el) => el.closest("#overview-evidence") === null;
    const cards = [...document.querySelectorAll("#overview-content .ov-finding")].filter(inFeed);
    const box = (c) => c.querySelector('[data-act="memo"]');
    return {
      ids: cards.map((c) => c.dataset.fid),
      ticked: cards.filter((c) => box(c) && box(c).checked).map((c) => c.dataset.fid),
      groups: [...document.querySelectorAll("#overview-content .ov-finding-group")].map((g) => g.dataset.detector),
    };
  });
  const f2 = {};
  try {
    Object.assign(f2, await page.evaluate(() => {
      const an = require("./state.js").getSession().analysis || {};
      return {
        pdd: an.pdd_findings || null,
        claims: Object.fromEntries((an.findings || []).map((f) => [f.id, f.claim])),
        repetitionInAnalysis: (an.findings || []).some((f) => f.detector === "repetition"),
      };
    }));
    f2.start = await feedState();
    f2.selBefore = readAnno().memo_selection || [];
  } catch (e) {
    logActionError("F2 default ticks", e);
    f2.err = String(e.message).split("\n")[0];
  }
  const D = (f2.pdd && f2.pdd.default) || [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  record("F2 + AD-20: with nothing ticked the boxes show the PDD's default findings; the feed is the printable findings, with no repeated-sequence group",
    !!(!f2.err && D.length >= 2 && f2.selBefore.length === 0 && same(f2.start.ticked, D) &&
      same(f2.start.ids, f2.pdd.eligible) && f2.repetitionInAnalysis && !f2.start.groups.includes("repetition")),
    JSON.stringify({ pdd: f2.pdd, start: f2.start, selBefore: f2.selBefore, repetitionInAnalysis: f2.repetitionInAnalysis, err: f2.err }));

  // Untick every box in turn: each untick stores the others explicitly; the
  // last one returns to the default and says so in one toast line. Then untick
  // the first one again and keep that for the export below.
  const untick = async (fid, expectSel) => {
    // One real click. Not uncheck(): unticking the last box ticks the default
    // again by design, which uncheck() reads as a click that did not take.
    await page.locator('#overview-content .ov-finding[data-fid="' + fid + '"] [data-act="memo"]').click({ timeout: T });
    const deadline = Date.now() + T;
    let sel = null;
    while (Date.now() < deadline) {
      try { sel = readAnno().memo_selection; } catch (_) { sel = null; }
      if (same(sel, expectSel)) break;
      await wait(150);
    }
    return { sel, feed: await feedState() };
  };
  const steps2 = [];
  let toastLine = null;
  try {
    for (let i = 0; i < D.length; i++) {
      const expect = D.slice(i + 1);
      const r = await untick(D[i], expect);
      if (i === D.length - 1) {
        // The toast and the re-render that ticks the default again come
        // together once the save is done: read the boxes after the toast.
        await page.waitForFunction(() => /PDD prints its default findings/.test((document.getElementById("toast") || {}).textContent || ""),
          null, { timeout: T });
        toastLine = (await page.$eval("#toast", (el) => el.textContent || "")).trim();
        r.feed = await feedState();
      }
      steps2.push({ unticked: D[i], stored: r.sel, ticked: r.feed.ticked });
    }
    f2.kept = D.slice(1);
    f2.dropped = D[0];
    const r = await untick(D[0], f2.kept);
    f2.final = { stored: r.sel, ticked: r.feed.ticked };
  } catch (e) {
    logActionError("F2 untick", e);
    f2.untickErr = String(e.message).split("\n")[0];
  }
  const partialOk = steps2.length === D.length && steps2.slice(0, -1).every((s, i) =>
    same(s.stored, D.slice(i + 1)) && same(s.ticked, D.slice(i + 1)));
  record("F2: unticking a box stores the other ticked findings, and the boxes show just those",
    !!(!f2.untickErr && partialOk && f2.final && same(f2.final.stored, f2.kept) && same(f2.final.ticked, f2.kept)),
    JSON.stringify({ steps: steps2.slice(0, -1), final: f2.final, err: f2.untickErr }));
  const last = steps2[steps2.length - 1];
  record("F2: unticking the last box returns to the PDD's default (nothing stored, the default ticked again) and says so in one toast line",
    !!(last && same(last.stored, []) && same(last.ticked, D) &&
      toastLine === "No finding is ticked, so the PDD prints its default findings."),
    JSON.stringify({ last, toastLine }));

  // Item 4a: the "how this was measured" methodology sentence renders AT MOST
  // ONCE per detector group.
  const method = await page.evaluate(() => {
    const groups = [...document.querySelectorAll("#overview-content .ov-finding-group")];
    const perGroup = groups.map((g) => ({
      det: g.dataset.detector,
      cards: g.querySelectorAll(".ov-finding").length,
      methodEls: g.querySelectorAll(".ov-finding-method").length,
    }));
    return {
      groups: groups.length,
      perCardNotes: document.querySelectorAll("#overview-content .ov-finding .ov-finding-note").length,
      maxMethodPerGroup: perGroup.reduce((m, g) => Math.max(m, g.methodEls), 0),
      repetition: perGroup.find((g) => g.det === "repetition") || null,
    };
  }).catch((e) => ({ err: e.message }));
  record("(c) methodology sentence renders at most once per detector group; no Repeated sequences group (AD-20)",
    !!(method && !method.err && method.groups > 0 && method.maxMethodPerGroup <= 1 &&
      method.perCardNotes === 0 && method.repetition === null),
    JSON.stringify(method));

  // Item 4b + 5: a finding card is resident claim + expand chevron; the
  // evidence body (with the screenshot chip, not a raw path) is one click in.
  const cardStruct = await page.evaluate(() => {
    const shotChips = document.querySelectorAll('#overview-content [data-act="shot"]');
    const rawPathLeak = /screenshots\/shot_\d+\.png/.test(
      (document.querySelector("#overview-content") || {}).textContent || "");
    const card = [...document.querySelectorAll("#overview-content .ov-finding")]
      .find((c) => c.querySelector(".ov-finding-body"));
    let expandedOk = null;
    if (card) {
      const body = card.querySelector(".ov-finding-body");
      const before = body.hidden;
      const btn = card.querySelector('[data-act="expand"]');
      if (btn) btn.click();
      expandedOk = before === true && body.hidden === false;
    }
    return { shotChips: shotChips.length, rawPathLeak, expandedOk };
  }).catch((e) => ({ err: e.message }));
  record("(4b/5) findings are resident claim + expand-in-place evidence; screenshot is a chip",
    !!(cardStruct && !cardStruct.err && cardStruct.shotChips >= 1 &&
      cardStruct.rawPathLeak === false && cardStruct.expandedOk === true),
    JSON.stringify(cardStruct));

  // BA-helper cut: no next-act rail, data sharing select, Copy for AI review,
  // memo export or ROI module.
  const cutSurfaces = await page.evaluate(() => ({
    rail: document.querySelectorAll("#ov-rail").length,
    sharingSelect: document.querySelectorAll("#ov-posture-select").length,
    copyForAi: document.querySelectorAll("#btn-ov-copy-llm").length,
    memoExport: document.querySelectorAll("#btn-ov-export-memo").length,
    roiModule: document.querySelectorAll('#overview-evidence .analysis-module[data-module="roi"]').length,
  })).catch((e) => ({ err: e.message }));
  record("cut Overview surfaces are gone (next-act rail, data sharing, Copy for AI review, memo export, ROI)",
    !!(cutSurfaces && !cutSurfaces.err && Object.values(cutSurfaces).every((n) => n === 0)),
    JSON.stringify(cutSurfaces));

  await shot(page, "overview-markers-state.png");

  // ==== (d) The analyst path, walked: each next act lands where it says ======
  const lineState = () => page.evaluate(() => {
    const line = document.getElementById("ov-next");
    return line ? {
      next: line.dataset.next,
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
      done: [...line.querySelectorAll(".ov-next-stage.done")].map((li) => li.dataset.stage),
    } : null;
  });
  const goOverview = async () => {
    await page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: T });
    await page.waitForSelector("#ov-next", { state: "visible", timeout: T });
  };
  const stepsLanding = () => page.evaluate(() => {
    const layout = document.getElementById("session-layout-steps");
    const open = [...document.querySelectorAll("#step-list .run-group.open")];
    const g = open[0];
    const sel = require("./state.js").getSelectedStepId();
    const row = g && sel ? [...g.querySelectorAll(".step-row")].find((r) => r.dataset.stepId === sel) : null;
    return {
      onSteps: !!(layout && getComputedStyle(layout).display !== "none") &&
        !!(document.querySelector('.view-mode-btn[data-level="steps"].active')),
      openRuns: open.length,
      openTitle: g ? ((g.querySelector(".run-title") || {}).textContent || "").trim() : null,
      openIsPattern: !!(g && g.classList.contains("pattern")),
      selectedInOpenRun: !!(row && row.classList.contains("selected")),
    };
  });
  const walk = { landings: {} };
  try {
    // 1. The pattern run: the button opens Steps on Run 1 (the pattern).
    await page.locator("#btn-ov-next").click({ timeout: T });
    await page.waitForSelector("#step-list .run-group.open", { state: "visible", timeout: T });
    walk.landings.pattern = await stepsLanding();
    await page.locator('#step-list .run-group.open [data-act="confirm-run"]').click({ timeout: T });
    await page.waitForFunction(() => /Confirmed/.test(((document.querySelector("#step-list .run-group.open .run-status")
      || {}).textContent) || ""), null, { timeout: T });
    await goOverview();
    walk.afterPattern = await lineState();
    // 2. The other runs: each click opens the first run still drafted.
    walk.landings.review = [];
    for (let i = 0; i < 3; i++) {
      const before = await lineState();
      if (!before || before.next !== "review") break;
      await page.locator("#btn-ov-next").click({ timeout: T });
      await page.waitForSelector("#step-list .run-group.open", { state: "visible", timeout: T });
      const landed = Object.assign(await stepsLanding(), { button: before.button });
      walk.landings.review.push(landed);
      await page.locator('#step-list .run-group.open [data-act="confirm-run"]').click({ timeout: T });
      await page.waitForFunction(() => /Confirmed/.test(((document.querySelector("#step-list .run-group.open .run-status")
        || {}).textContent) || ""), null, { timeout: T });
      await goOverview();
    }
    walk.afterReview = await lineState();
    // 3. The document sections: the button opens the panel on its first
    // empty field, with the cursor in it.
    await page.locator("#btn-ov-next").click({ timeout: T });
    await page.waitForFunction(() => {
      const d = document.getElementById("ov-doc");
      return !!(d && d.open && document.activeElement && document.activeElement.dataset.doc);
    }, null, { timeout: T });
    walk.landings.document = await page.evaluate(() => ({
      open: document.getElementById("ov-doc").open,
      focused: document.activeElement.dataset.doc,
      status: (document.getElementById("ov-doc-status") || {}).textContent,
    }));
  } catch (e) {
    logActionError("(d) path walk", e);
    walk.err = String(e.message).split("\n")[0];
  }
  const L = walk.landings;
  record("(d1) 'Confirm Run 1 in Steps' lands on Steps with the pattern run open and its first step selected",
    !!(L.pattern && L.pattern.onSteps && L.pattern.openRuns === 1 && L.pattern.openTitle === "Run 1" &&
      L.pattern.openIsPattern && L.pattern.selectedInOpenRun),
    JSON.stringify({ landing: L.pattern, err: walk.err }));
  record("(d2) a confirmed pattern run shows done; the next act is the first run still drafted",
    !!(walk.afterPattern && walk.afterPattern.next === "review" && walk.afterPattern.done.includes("pattern") &&
      walk.afterPattern.button === "Review Run 2 in Steps"),
    JSON.stringify(walk.afterPattern));
  const reviewOk = Array.isArray(L.review) && L.review.length === 3 && L.review.every((l, i) =>
    l.onSteps && l.openRuns === 1 && l.openTitle === "Run " + (i + 2) && !l.openIsPattern &&
    l.selectedInOpenRun && l.button === "Review Run " + (i + 2) + " in Steps");
  record("(d3) 'Review Run N in Steps' lands on Steps with that run open, for runs 2 to 4; then the review shows done",
    !!(reviewOk && walk.afterReview && walk.afterReview.next === "document" && walk.afterReview.done.includes("review")),
    JSON.stringify({ review: L.review, after: walk.afterReview }));
  record("(d4) 'Fill the document sections' opens the collapsed panel with the cursor in its first empty field",
    !!(L.document && L.document.open && L.document.focused === "title" && L.document.status === "0 of 6 filled"),
    JSON.stringify(L.document));

  // 4. A document field saves through the one write path, undoably.
  const PURPOSE = "E2E purpose: settle the monthly supplier invoices";
  const docProbe = {};
  try {
    const purpose = page.locator('#ov-doc [data-doc="purpose"]');
    await purpose.fill(PURPOSE, { timeout: T });
    await purpose.press("Tab");                          // change fires on leaving the field
    await page.waitForFunction(() => (document.getElementById("ov-doc-status") || {}).textContent === "1 of 6 filled",
      null, { timeout: T });
    docProbe.saved = (readAnno().document || {}).purpose;
    // Undo: Ctrl+Z outside a field is the app's undo.
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => {
      const t = document.querySelector('#ov-doc [data-doc="purpose"]');
      return !!(t && t.value === "");
    }, null, { timeout: T });
    // The Purpose is gone from disk again (the document had no Purpose before).
    docProbe.afterUndoOnDisk = (readAnno().document || {}).purpose || "";
    docProbe.panelStayedOpen = await page.evaluate(() => document.getElementById("ov-doc").open);
    // Write every section again (Purpose, then the other five).
    const values = {
      title: "E2E order intake", purpose: PURPOSE, scope: "From the order e-mail to the order confirmation",
      contacts: "Process owner: E2E Owner", business_rules: "Orders above the credit limit need a check",
      exceptions: "A blocked customer stops the run",
    };
    for (const [k, v] of Object.entries(values)) {
      const el = page.locator('#ov-doc [data-doc="' + k + '"]');
      await el.fill(v, { timeout: T });
      await el.press("Tab");
    }
    await page.waitForFunction(() => (document.getElementById("ov-doc-status") || {}).textContent === "6 of 6 filled",
      null, { timeout: T });
    docProbe.onDisk = readAnno().document || {};
    docProbe.line = await lineState();
    docProbe.summaryName = await page.evaluate(() =>
      ((document.querySelector("#ov-summary .ov-summary-name") || {}).textContent || "").trim());
  } catch (e) {
    logActionError("(d5) document fields", e);
    docProbe.err = String(e.message).split("\n")[0];
  }
  record("(d5) a document field saves to annotations.document (contract C6), and Ctrl+Z takes it back",
    !!(!docProbe.err && docProbe.saved === PURPOSE && docProbe.afterUndoOnDisk === "" && docProbe.panelStayedOpen),
    JSON.stringify({ saved: docProbe.saved, afterUndoOnDisk: docProbe.afterUndoOnDisk,
      panelStayedOpen: docProbe.panelStayedOpen, err: docProbe.err }));
  record("(d6) with the six sections written the document stage shows done; the next act is the As-Is map",
    !!(docProbe.line && docProbe.line.next === "map" && docProbe.line.done.includes("document") &&
      docProbe.onDisk && docProbe.onDisk.purpose === PURPOSE && docProbe.onDisk.notes === ""),
    JSON.stringify({ line: docProbe.line, onDisk: docProbe.onDisk }));
  record("(P3.9) once written, the document title names the recording on the summary line",
    docProbe.summaryName === "E2E order intake", JSON.stringify({ summaryName: docProbe.summaryName }));

  // 5. The As-Is map: the button lands on the Map; Fork, choose the copy as
  // the PDD's As-Is map, and the stage shows done.
  const mapProbe = {};
  try {
    await page.locator("#btn-ov-next").click({ timeout: T });
    await page.waitForSelector("#session-layout-map", { state: "visible", timeout: T });
    mapProbe.landed = await page.evaluate(() => ({
      onMap: !!document.querySelector('.view-mode-btn[data-level="map"].active'),
      mapDrawn: !!((document.getElementById("session-map-dfg-host") || {}).__cy),
      fork: !!document.getElementById("btn-fork-refmap"),
    }));
    await page.locator("#btn-fork-refmap").click({ timeout: T });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: T });
    await page.locator("#refmap-editor-pdd").selectOption("as_is", { timeout: T });
    await wait(500);
    await page.locator("#btn-refmap-editor-close").click({ timeout: T });
    // A second copy, chosen as the PDD's To-Be map (the gallery is open after
    // the fork): Duplicate, then the copy's PDD select.
    await page.locator('#refmap-list [data-rm-act="dup"]').first().click({ timeout: T });
    await page.waitForFunction(() => document.querySelectorAll("#refmap-list .refmap-row").length === 2, null, { timeout: T });
    await page.locator("#refmap-list .refmap-row").nth(1).locator("[data-rm-pdd]").selectOption("to_be", { timeout: T });
    await wait(500);
    mapProbe.roles = (readAnno().reference_maps || []).map((m) => m && m.pdd_role);
    await goOverview();
    mapProbe.line = await lineState();
    mapProbe.asIs = (readAnno().reference_maps || []).filter((m) => m && m.pdd_role === "as_is").length;
  } catch (e) {
    logActionError("(d7) As-Is map", e);
    mapProbe.err = String(e.message).split("\n")[0];
  }
  record("(d7) 'Finish the As-Is map in Map' lands on the Map; a fork chosen as the PDD's As-Is map shows the stage done",
    !!(!mapProbe.err && mapProbe.landed && mapProbe.landed.onMap && mapProbe.landed.mapDrawn && mapProbe.landed.fork &&
      mapProbe.asIs === 1 && JSON.stringify(mapProbe.roles) === '["as_is","to_be"]' &&
      mapProbe.line && mapProbe.line.next === "export" && mapProbe.line.done.includes("map") &&
      mapProbe.line.button === "Export PDD"),
    JSON.stringify(mapProbe));

  // The export renders the maps chosen for the PDD off screen; record what it
  // handed over (the As-Is and To-Be images), so the embed is pinned too.
  await page.evaluate(() => {
    const RefmapUI = require("./refmap-ui.js");
    const orig = RefmapUI.renderPddMaps;
    RefmapUI.renderPddMaps = async () => {
      const out = await orig();
      window.__pddMaps = { asis: !!(out && out.asis), tobe: !!(out && out.tobe) };
      return out;
    };
  }).catch((e) => console.log("spy", e.message));

  // 6. The last act: Export PDD. It runs the Session menu's PDD export
  // (#btn-session-pdd). Stub the save dialog to a temp path and the shell
  // reveal (no Explorer window in a gate), poll for a real .docx (a zip: "PK"
  // magic). Item 7: the shared path shows the Map while it draws the map
  // image, then returns the analyst to the Overview with the level bar in
  // sync. Contract C6 end to end: the document carries the Purpose written
  // above, in place of the placeholder.
  const pddOut = path.join(os.tmpdir(), "pdt-ov-e2e-" + Date.now() + ".docx");
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.showItemInFolder = () => {};
  }, pddOut).catch((e) => console.log("stub dialog", e.message));
  await page.click("#btn-ov-next").catch((e) => console.log("export click", e.message));
  let pddOk = false, pddDetail = "", docXml = null;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (fs.existsSync(pddOut)) {
      const buf = fs.readFileSync(pddOut);
      if (buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b) {
        pddOk = true;
        pddDetail = buf.length + " bytes, zip (docx) magic";
        try { docXml = readZipEntry(buf, "word/document.xml"); } catch (e) { pddDetail += "; unzip failed: " + e.message; }
        break;
      }
    }
    await wait(500);
  }
  if (!pddOk) pddDetail = "no .docx at the stubbed save path after 180s";
  const levelProbe = () => {
    const shown = ["overview", "flow", "steps", "map"].filter((l) => {
      const el = document.getElementById("session-layout-" + l);
      return el && getComputedStyle(el).display !== "none";
    });
    const lit = [...document.querySelectorAll(".view-mode-btn.active")].map((b) => b.dataset.level);
    return { shown, lit, level: require("./state.js").getLevel() };
  };
  await page.waitForFunction(() => {
    const el = document.getElementById("session-layout-overview");
    return el && getComputedStyle(el).display !== "none";
  }, null, { timeout: 30000 }).catch(() => {});
  const after = await page.evaluate(levelProbe).catch((e) => ({ err: e.message }));
  const backInSync = !!(after && !after.err && after.level === "overview" &&
    JSON.stringify(after.shown) === '["overview"]' && JSON.stringify(after.lit) === '["overview"]');
  record("(d8) 'Export PDD' writes a .docx through the Session menu's PDD path, then returns to the Overview with the level bar in sync",
    pddOk && backInSync, pddDetail + " after=" + JSON.stringify(after));
  if (!(pddOk && backInSync)) await shot(page, "fail-overview-pdd.png");
  const handed = await page.evaluate(() => window.__pddMaps || null).catch(() => null);
  const docChecks = {
    handed,
    // Each map picture carries its alternative text (lane LUX-P); the To-Be
    // map has its own heading in the improvement section.
    asIsEmbedded: !!(docXml && docXml.includes('descr="As-Is process map"')),
    toBeEmbedded: !!(docXml && docXml.includes('descr="To-Be process map"') &&
      docXml.includes("7.1 To-Be process map")),
    purpose: !!(docXml && docXml.includes(PURPOSE)),
    title: !!(docXml && docXml.includes("E2E order intake")),
    purposePlaceholderGone: !!(docXml && !docXml.includes("the business need this process serves")),
    keptAfterExport: (readAnno().document || {}).purpose === PURPOSE,
  };
  record("(d9) contract C6 end to end: the exported PDD (word/document.xml) carries the Purpose written on the Overview, in place of its placeholder",
    !!(docChecks.purpose && docChecks.title && docChecks.purposePlaceholderGone && docChecks.keptAfterExport),
    JSON.stringify(Object.assign({ xmlBytes: docXml ? docXml.length : 0 }, docChecks)));
  record("(d10) the reference maps chosen as the PDD's As-Is and To-Be maps are embedded in the export",
    !!(handed && handed.asis && handed.tobe && docChecks.asIsEmbedded && docChecks.toBeEmbedded),
    JSON.stringify({ handed, asIsEmbedded: docChecks.asIsEmbedded, toBeEmbedded: docChecks.toBeEmbedded }));
  try { fs.unlinkSync(pddOut); } catch (_) {}

  // F2, end to end, after lane LUX-P cut the PDD's findings section: the
  // export prints no finding, neither the ones still ticked above nor the
  // unticked one (the boxes stay until the viewer lane removes them).
  const xmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inDoc = (fid) => !!(docXml && f2.claims && f2.claims[fid] && docXml.includes(xmlText(f2.claims[fid])));
  const printedKept = (f2.kept || []).map(inDoc);
  record("F2: the exported PDD prints no finding, ticked or not (its findings section is cut)",
    !!(docXml && f2.kept && f2.kept.length && !printedKept.some(Boolean) && !inDoc(f2.dropped)),
    JSON.stringify({ kept: f2.kept, printedKept, dropped: f2.dropped, droppedPrinted: inDoc(f2.dropped) }));

  // P2.12: with an As-Is copy chosen for the PDD, the Export menu's map items
  // save that copy (the map the analyst finished), not the process map.
  const exportVia = async (itemId, outPath) => {
    await app.evaluate(({ dialog, shell }, p) => {
      global.__pdtSaveDefault = null;
      dialog.showSaveDialog = async (_w, opts) => {
        global.__pdtSaveDefault = (opts && opts.defaultPath) || null;
        return { canceled: false, filePath: p };
      };
      shell.showItemInFolder = () => {};
    }, outPath);
    await page.locator("#btn-session-export-menu").click({ timeout: T });
    await page.locator("#" + itemId).click({ timeout: T });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) break;
      await wait(250);
    }
    await wait(300);
    const text = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
    const suggested = await app.evaluate(() => global.__pdtSaveDefault).catch(() => null);
    try { fs.unlinkSync(outPath); } catch (_) {}
    return { text, suggested: suggested ? path.basename(suggested) : null };
  };
  const mapExport = {};
  try {
    const asIsEntry = (readAnno().reference_maps || []).find((m) => m && m.pdd_role === "as_is");
    mapExport.asIsFile = asIsEntry ? asIsEntry.file : null;
    const asIsXml = asIsEntry ? fs.readFileSync(path.join(SESSION_MARKED, asIsEntry.file), "utf-8") : null;
    const bpmn = await exportVia("btn-session-step-bpmn", path.join(os.tmpdir(), "pdt-ov-e2e-asis-" + Date.now() + ".bpmn"));
    mapExport.bpmnIsTheCopy = !!(asIsXml && bpmn.text === asIsXml);
    mapExport.bpmnSuggested = bpmn.suggested;
    const svg = await exportVia("btn-session-map-svg", path.join(os.tmpdir(), "pdt-ov-e2e-asis-" + Date.now() + ".svg"));
    mapExport.svgSuggested = svg.suggested;
    mapExport.svgIsBpmnDrawing = /<svg[\s>]/.test(svg.text) && /djs-/.test(svg.text) && !/Flow diagram \(DFG\)/.test(svg.text);
    mapExport.labels = await page.evaluate(() => ["btn-session-map-svg", "btn-session-step-bpmn"]
      .map((id) => ((document.getElementById(id) || {}).textContent || "").trim()));
  } catch (e) {
    logActionError("P2.12 map exports", e);
    mapExport.err = String(e.message).split("\n")[0];
  }
  record("P2.12: with an As-Is copy chosen, Export > Process map (BPMN) saves that copy and Process map (image) draws it",
    !!(!mapExport.err && mapExport.asIsFile && mapExport.bpmnIsTheCopy && mapExport.bpmnSuggested === "as-is-map.bpmn" &&
      mapExport.svgIsBpmnDrawing && mapExport.svgSuggested === "as-is-map.svg" &&
      JSON.stringify(mapExport.labels) === '["Process map (image)","Process map (BPMN)"]'),
    JSON.stringify(mapExport));

  await close();

  // ================= Launch 2: the marker-stripped copy (no runs marked) ==
  let page2, close2;
  try {
    ({ page: page2, close: close2 } = await launch(SESSION_STRIPPED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (stripped):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (e) AD-14: with no runs the line's next act is marking runs, with the
  // one-line instruction and the button.
  const markRuns = await page2.evaluate(() => {
    const line = document.getElementById("ov-next");
    return {
      next: line ? line.dataset.next : null,
      lineText: line ? (line.textContent || "").trim() : null,
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
      badges: document.querySelectorAll("#overview-content .ov-badge, #ov-mark-runs").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("(e) marker-stripped session: the What is left line says no runs are marked, with the instruction and 'Mark runs in Flow'",
    !!(markRuns && !markRuns.err && markRuns.next === "runs" && /no runs marked/i.test(markRuns.lineText || "") &&
      /start marker/i.test(markRuns.lineText || "") && markRuns.button === "Mark runs in Flow" && markRuns.badges === 0),
    JSON.stringify(markRuns));
  if (!(markRuns && markRuns.next === "runs")) await shot(page2, "fail-overview-mark-runs.png");

  await shot(page2, "overview-unsegmented-state.png");

  // (e2) The button LANDS: Flow shows, with the Markers panel (pre-state: the
  // Notes tab is the active annotation tab).
  const markersTabBefore = await page2.evaluate(() => {
    const t = document.querySelector('.anno-tab[data-anno="markers"]');
    return !!(t && t.classList.contains("active"));
  }).catch(() => null);
  await page2.click("#btn-ov-next").catch((e) => console.log("mark-runs click", e.message));
  await wait(700);
  const landed = await page2.evaluate(() => {
    const flow = document.querySelector("#session-layout-flow");
    const tab = document.querySelector('.anno-tab[data-anno="markers"]');
    const panel = document.querySelector('.anno-panel[data-panel="markers"]');
    const r = panel ? panel.getBoundingClientRect() : null;
    return {
      flowVisible: !!(flow && getComputedStyle(flow).display !== "none"),
      markersTabActive: !!(tab && tab.classList.contains("active")),
      markersPanelVisible: !!(panel && getComputedStyle(panel).display !== "none"),
      panelOnScreen: !!(r && r.height > 0 && r.top < window.innerHeight && r.bottom > 0),
    };
  }).catch((e) => ({ err: e.message }));
  record("(e2) 'Mark runs in Flow' lands on Flow with the Markers panel showing on screen",
    !!(landed && !landed.err && markersTabBefore === false && landed.flowVisible &&
      landed.markersTabActive && landed.markersPanelVisible && landed.panelOnScreen),
    JSON.stringify({ markersTabBefore, landed }));
  if (!(landed && landed.markersPanelVisible)) await shot(page2, "fail-overview-mark-runs-land.png");

  // The existing levels must still be reachable from the new default.
  await page2.click('.view-mode-btn[data-level="overview"]').catch(() => {});
  await wait(500);
  const flowStillWorks = await (async () => {
    const btn = await page2.$('.view-mode-btn[data-level="flow"]');
    if (!btn) return false;
    await btn.click().catch(() => {});
    await wait(900);
    return page2.$eval("#session-layout-flow", (el) =>
      getComputedStyle(el).display !== "none").catch(() => false);
  })();
  record("levels still switch from the new default (Flow renders)", flowStillWorks,
    flowStillWorks ? "" : "#session-layout-flow did not show after click");

  await close2();

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
