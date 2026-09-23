"use strict";
/*
 * Overview-level e2e smoke (lab-phase spec §A6) — the Phase A merge gate.
 *
 * Launches the REAL viewer twice and asserts the honesty redesign's
 * landing surface end-to-end:
 *   (a) the DEFAULT level is Overview (#session-layout-overview visible,
 *       its view-mode button active, the Flow layout hidden) — no clicks;
 *   (b) the case-quality badge renders the markers state on the demo
 *       session ("✓ Markers — N cases" + Tier 2 unlocked);
 *   (c) the fact strip renders 6 non-empty tiles (and none is clipped:
 *       scrollWidth must not exceed clientWidth; labels have drifted
 *       before, see e1f5680);
 *   (d) on a marker-STRIPPED re-normalized temp copy the mark-runs line
 *       renders (the no-runs call to action), and its button opens Flow
 *       with the Markers panel showing;
 *   (e) the "Export PDD" button writes a .docx through the Session menu's
 *       PDD export path;
 *   (f) zero PAGE ERRORs across both launches.
 *
 * Screenshots of BOTH Overview states land in this dir (gitignored):
 *   overview-markers-state.png / overview-unsegmented-state.png.
 *
 * Like session-smoke.js it re-normalizes into TEMP copies so the
 * committed demo is never regenerated in place, and reuses the viewer's
 * own Electron. Unlike session-smoke, a missing deps-bearing Python is a
 * HARD FAIL here — every assertion depends on current pipeline output.
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

(async () => {
  // ---- Prepare both sessions (hard prerequisite) --------------------------
  const SESSION_MARKED = makeTempSession({ stripMarkers: false });
  const SESSION_STRIPPED = makeTempSession({ stripMarkers: true });
  if (!normalize(SESSION_MARKED) || !normalize(SESSION_STRIPPED)) {
    record("re-normalize temp sessions (prerequisite)", false, "no deps-bearing Python");
    process.exit(1);
  }

  const pageErrors = [];

  // ================= Launch 1: the marked demo (markers state) ============
  let app, page;
  try {
    ({ app, page } = await launch(SESSION_MARKED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (a) Default level is Overview — asserted with ZERO clicks.
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

  // (b) Case-quality badge: markers state on the 4-case demo. Item 8 merged
  // the duplicate "case analysis on" chip INTO the badge as its subtitle
  // (.ov-badge-sub), so the "one fact, one place" merge is pinned here — the
  // separate .ov-tier2 chip must be gone.
  const badge = await page.evaluate(() => {
    const b = document.querySelector("#overview-content .ov-badge");
    const main = b && b.querySelector(".ov-badge-text");
    const sub = b && b.querySelector(".ov-badge-sub");
    return {
      text: main ? (main.textContent || "").trim() : (b ? (b.textContent || "").trim() : null),
      ok: !!(b && b.classList.contains("ok")),
      sub: sub ? (sub.textContent || "").trim() : null,
      legacyTier2: document.querySelectorAll("#overview-content .ov-tier2").length,
    };
  }).catch((e) => ({ err: e.message }));
  const badgeOk = !!(badge && !badge.err && badge.ok &&
    /✓ \d+ cases? — marked by the worker/.test(badge.text || "") &&
    /case analysis on/i.test(badge.sub || "") &&
    badge.legacyTier2 === 0);
  record("(b) badge shows the worker-marked state + case analysis on as its subtitle (item 8 merge)",
    badgeOk, JSON.stringify(badge));

  // (c) Fact strip: 6 tiles, every value non-empty, no clipped labels.
  const tiles = await page.evaluate(() => {
    const els = [...document.querySelectorAll("#overview-content .ov-tile")];
    const clipped = [];
    els.forEach((tile) => {
      tile.querySelectorAll(".ov-tile-value, .ov-tile-label, .ov-tile-sub").forEach((el) => {
        if ((el.textContent || "").trim() && el.scrollWidth > el.clientWidth + 2) {
          clipped.push((el.textContent || "").trim() + " (" + el.clientWidth + "<" + el.scrollWidth + ")");
        }
      });
    });
    return {
      count: els.length,
      values: els.map((t) => {
        const v = t.querySelector(".ov-tile-value");
        return v ? (v.textContent || "").trim() : "";
      }),
      clipped,
    };
  }).catch((e) => ({ err: e.message }));
  const tilesOk = !!(tiles && !tiles.err && tiles.count === 6 &&
    tiles.values.every((v) => v.length > 0));
  record("(c) fact strip renders 6 non-empty tiles", tilesOk, JSON.stringify(tiles && tiles.values));
  record("(c2) no fact-strip label is clipped (scrollWidth <= clientWidth)",
    !!(tiles && !tiles.err && tiles.clipped.length === 0),
    tiles && tiles.clipped && tiles.clipped.length ? "clipped: " + tiles.clipped.join(", ") : "all fit");

  // R4: the Evidence modules (retired Analysis) render below the findings feed.
  const evidence = await page.evaluate(() => {
    const host = document.querySelector("#overview-content #overview-evidence");
    if (!host) return { present: false };
    const mods = [...host.querySelectorAll(".analysis-module[data-module]")]
      .map((m) => m.getAttribute("data-module"));
    return { present: true, modules: mods };
  }).catch((e) => ({ err: e.message }));
  record("R4: Evidence modules (time / automation) render in #overview-evidence below the findings, no ROI module",
    !!(evidence && !evidence.err && evidence.present &&
      evidence.modules.includes("time") && evidence.modules.includes("automation") &&
      !evidence.modules.includes("roi")),
    JSON.stringify(evidence));

  // Findings feed sanity on the demo (claims + an "include in PDD" checkbox on
  // every card; the checkbox still writes annotations.memo_selection).
  const feed = await page.evaluate(() => {
    // R4: the Evidence host below the feed reuses the .ov-finding component for
    // automation candidate cards (no PDD checkbox). Scope the findings-feed
    // count to cards OUTSIDE #overview-evidence so the "every finding has a PDD
    // checkbox" invariant still holds exactly (never weakened).
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

  // AD-13: ticking "include in PDD" still writes annotations.memo_selection
  // (the PDD's findings section reads that key). Tick the first unticked box,
  // read the saved annotations.json, then untick to leave the session as found.
  const tick = await page.evaluate(async () => {
    const inFeed = (el) => el.closest("#overview-evidence") === null;
    const box = [...document.querySelectorAll('#overview-content [data-act="memo"]')].filter(inFeed)
      .find((c) => !c.checked);
    if (!box) return { err: "no unticked PDD checkbox" };
    const fid = box.closest(".ov-finding").dataset.fid;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return { fid };
  }).catch((e) => ({ err: e.message }));
  await wait(800);
  let savedSel = null;
  try {
    savedSel = JSON.parse(fs.readFileSync(path.join(SESSION_MARKED, "annotations.json"), "utf-8")).memo_selection;
  } catch (e) { savedSel = "read error: " + e.message; }
  record("AD-13: ticking 'include in PDD' saves the finding id to annotations.memo_selection",
    !!(tick && !tick.err && Array.isArray(savedSel) && savedSel.includes(tick.fid)),
    JSON.stringify({ tick, savedSel }));
  await page.evaluate((fid) => {
    const row = document.querySelector('#overview-content .ov-finding[data-fid="' + fid + '"]');
    const box = row && row.querySelector('[data-act="memo"]');
    if (box && box.checked) { box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); }
  }, tick && tick.fid).catch(() => {});
  await wait(500);

  // Item 4a (ADD pin d): the "how this was measured" methodology sentence
  // renders AT MOST ONCE per detector group. The demo has 3 `repetition`
  // findings that used to repeat the same sentence 3×; now each detector
  // group carries a single ⓘ methodology disclosure.
  const method = await page.evaluate(() => {
    const groups = [...document.querySelectorAll("#overview-content .ov-finding-group")];
    const perGroup = groups.map((g) => ({
      det: g.dataset.detector,
      cards: g.querySelectorAll(".ov-finding").length,
      methodEls: g.querySelectorAll(".ov-finding-method").length,
    }));
    return {
      groups: groups.length,
      // per-card methodology notes must NOT exist (moved to the group ⓘ)
      perCardNotes: document.querySelectorAll("#overview-content .ov-finding .ov-finding-note").length,
      // no detector group renders its methodology sentence more than once
      maxMethodPerGroup: perGroup.reduce((m, g) => Math.max(m, g.methodEls), 0),
      // the multi-finding repetition group exists and has one methodology
      repetition: perGroup.find((g) => g.det === "repetition") || null,
    };
  }).catch((e) => ({ err: e.message }));
  const methodOk = !!(method && !method.err && method.groups > 0 &&
    method.maxMethodPerGroup <= 1 && method.perCardNotes === 0 &&
    method.repetition && method.repetition.cards >= 2);
  record("(d) methodology sentence renders at most once per detector group",
    methodOk, JSON.stringify(method));

  // Item 4b + 5: a finding card is resident claim + expand chevron; the
  // evidence body (with the screenshot chip, not a raw path) is one click in.
  // The screen_time_sink finding carries a screenshot ref → a chip, not text.
  const cardStruct = await page.evaluate(() => {
    const shotChips = document.querySelectorAll('#overview-content [data-act="shot"]');
    const rawPathLeak = /screenshots\/shot_\d+\.png/.test(
      (document.querySelector("#overview-content") || {}).textContent || "");
    // Expand the first card that has a body, confirm the body reveals inline.
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

  // BA-helper cut: the Overview no longer carries the next-act rail, the data
  // sharing select, Copy for AI review, the memo export or the ROI module; and
  // on this marked demo the mark-runs line must not show.
  const cutSurfaces = await page.evaluate(() => ({
    rail: document.querySelectorAll("#ov-rail").length,
    sharingSelect: document.querySelectorAll("#ov-posture-select").length,
    copyForAi: document.querySelectorAll("#btn-ov-copy-llm").length,
    memoExport: document.querySelectorAll("#btn-ov-export-memo").length,
    roiModule: document.querySelectorAll('#overview-evidence .analysis-module[data-module="roi"]').length,
    markRuns: document.querySelectorAll("#ov-mark-runs").length,
    exportPdd: document.querySelectorAll("#btn-ov-export-pdd").length,
  })).catch((e) => ({ err: e.message }));
  record("cut Overview surfaces are gone; Export PDD present; no mark-runs line on a marked session",
    !!(cutSurfaces && !cutSurfaces.err && cutSurfaces.rail === 0 && cutSurfaces.sharingSelect === 0 &&
      cutSurfaces.copyForAi === 0 && cutSurfaces.memoExport === 0 && cutSurfaces.roiModule === 0 &&
      cutSurfaces.markRuns === 0 && cutSurfaces.exportPdd === 1),
    JSON.stringify(cutSurfaces));

  await shot(page, "overview-markers-state.png");

  // (e) AD-13: "Export PDD" runs the Session menu's PDD export (#btn-session-pdd).
  // Stub the save dialog to a temp path and the shell reveal (no Explorer
  // window in a gate), click the Overview button, poll for a real .docx (a
  // zip: "PK" magic). The shared path renders the map first, so the viewer
  // lands on the Map level: that pins "same path", not a second export.
  const pddOut = path.join(os.tmpdir(), "pdt-ov-e2e-" + Date.now() + ".docx");
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.showItemInFolder = () => {};
  }, pddOut).catch((e) => console.log("stub dialog", e.message));
  await page.click("#btn-ov-export-pdd").catch((e) => console.log("export click", e.message));
  let pddOk = false, pddDetail = "";
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (fs.existsSync(pddOut)) {
      const buf = fs.readFileSync(pddOut);
      if (buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b) {
        pddOk = true;
        pddDetail = buf.length + " bytes, zip (docx) magic";
        break;
      }
    }
    await wait(500);
  }
  if (!pddOk) pddDetail = "no .docx at the stubbed save path after 180s";
  const onMap = await page.evaluate(() => {
    const el = document.querySelector("#session-layout-map");
    return !!(el && getComputedStyle(el).display !== "none");
  }).catch(() => false);
  record("(e) Export PDD writes a .docx through the Session menu's PDD path (lands on Map)",
    pddOk && onMap, pddDetail + " onMap=" + onMap);
  if (!pddOk) await shot(page, "fail-overview-pdd.png");
  try { fs.unlinkSync(pddOut); } catch (_) {}

  await app.close().catch(() => {});

  // ================= Launch 2: the marker-stripped copy (no runs marked) ==
  let app2, page2;
  try {
    ({ app: app2, page: page2 } = await launch(SESSION_STRIPPED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (stripped):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (d) AD-14: unsegmented badge + the one-line mark-runs instruction.
  const markRuns = await page2.evaluate(() => {
    const badge = document.querySelector("#overview-content .ov-badge");
    const line = document.querySelector("#overview-content #ov-mark-runs");
    return {
      badgeText: badge ? (badge.textContent || "").trim() : null,
      badgeWarn: !!(badge && badge.classList.contains("warn")),
      lineText: line ? (line.textContent || "").trim() : null,
      button: !!document.querySelector("#overview-content #btn-ov-mark-runs"),
      heroRows: document.querySelectorAll("#overview-content .ov-hero-row").length,
    };
  }).catch((e) => ({ err: e.message }));
  const markRunsOk = !!(markRuns && !markRuns.err && markRuns.badgeWarn &&
    /No cases identified yet/.test(markRuns.badgeText || "") &&
    /no runs marked/i.test(markRuns.lineText || "") && /start marker/i.test(markRuns.lineText || "") &&
    markRuns.button && markRuns.heroRows === 0);
  record("(d) marker-stripped session: no-cases badge + the mark-runs instruction (no anchor hero)",
    markRunsOk, JSON.stringify(markRuns));
  if (!markRunsOk) await shot(page2, "fail-overview-mark-runs.png");

  await shot(page2, "overview-unsegmented-state.png");

  // (d2) The instruction's button LANDS: Flow shows, with the Markers panel
  // (pre-state: the Notes tab is the active annotation tab).
  const markersTabBefore = await page2.evaluate(() => {
    const t = document.querySelector('.anno-tab[data-anno="markers"]');
    return !!(t && t.classList.contains("active"));
  }).catch(() => null);
  await page2.click("#btn-ov-mark-runs").catch((e) => console.log("mark-runs click", e.message));
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
      emptyHint: ((document.querySelector("#markers-list") || {}).textContent || "").trim().slice(0, 120),
    };
  }).catch((e) => ({ err: e.message }));
  record("(d2) 'Mark runs in Flow' lands on Flow with the Markers panel showing on screen",
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
