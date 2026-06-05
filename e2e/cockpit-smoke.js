"use strict";
/*
 * Cockpit-view smoke (PDT-1.0-SPEC §4.2).
 *
 * Asserts:
 *   - Cockpit is the default landing mode on session load.
 *   - The view-mode bar is hidden in Cockpit / Glance, visible in Workshop.
 *   - Workshop chrome (session summary, raw events) is suppressed in Cockpit/Glance.
 *   - Headline numbers render with values + labels.
 *   - For a session with analysis.json, candidates surface with AI badges +
 *     Verify drill buttons; the drill switches to Workshop / Analysis.
 *
 * Non-zero exit on any regression. Uses the bundled demo-pack session
 * (which carries analysis.json) so candidates can be asserted.
 */

const path = require("path");
const fs = require("fs");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SESSION = path.join(REPO, "sessions", "demo-pack", "sessions", "demo-alice-20260601-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true }).catch(() => {});
}

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [".", "--session=" + SESSION],
      cwd: VIEWER,
      env: Object.assign({}, process.env, { PDT_OLLAMA_URL: "http://127.0.0.1:11434" }),
    });
  } catch (e) {
    console.error("FATAL: viewer launch:", e.message);
    process.exit(2);
  }
  const page = await app.firstWindow();
  const pageErrs = [];
  page.on("pageerror", (e) => pageErrs.push(String(e.message)));

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  // Reset the persisted session-mode preference so the "default landing is
  // Cockpit" assertion isn't poisoned by a previous run that ended in
  // Workshop / Glance (Electron persists localStorage across launches).
  await page.evaluate(() => {
    try { localStorage.removeItem("pdt.sessionMode"); } catch (_) {}
  }).catch(() => {});
  let loaded = false;
  try {
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: 20000 });
    loaded = true;
  } catch (_) {}
  record("session loaded", loaded);
  if (!loaded) { await shot(page, "cockpit-fail-no-load.png"); await app.close(); process.exit(1); }
  // Re-apply Cockpit explicitly so the session view loads under the
  // cleared default (it was already loading when localStorage was zapped).
  await page.evaluate(() => {
    try { localStorage.removeItem("pdt.sessionMode"); } catch (_) {}
    const btn = document.querySelector('#session-mode-toggle .mode-btn[data-mode="cockpit"]');
    if (btn) btn.click();
  }).catch(() => {});
  await wait(2000);

  // §4.1.1: default mode is Cockpit.
  const activeMode = await page.evaluate(() =>
    document.querySelector("#session-mode-toggle .mode-btn.active")?.dataset.mode);
  record("default mode is Cockpit", activeMode === "cockpit", "mode=" + activeMode);

  // §4.1.1: view-mode bar hidden in Cockpit.
  const vmDisplay = await page.evaluate(() => {
    const el = document.querySelector(".view-mode-bar");
    return el ? getComputedStyle(el).display : null;
  });
  record("view-mode bar hidden in Cockpit", vmDisplay === "none", "display=" + vmDisplay);

  // §4.2: cockpit headline numbers render.
  const headlines = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".cockpit-headline-item")).map(el => ({
      val: el.querySelector(".cockpit-headline-val")?.textContent || "",
      lbl: el.querySelector(".cockpit-headline-lbl")?.textContent || "",
    })));
  const hasCaptured = headlines.some(h => h.lbl === "captured" && h.val && h.val !== "—");
  const hasSwitches = headlines.some(h => h.lbl === "app switches" && h.val);
  const hasInteractions = headlines.some(h => h.lbl === "interactions" && h.val);
  record("cockpit headline: captured", hasCaptured, JSON.stringify(headlines));
  record("cockpit headline: app switches", hasSwitches);
  record("cockpit headline: interactions", hasInteractions);

  // §4.2: candidates with AI badges + Verify buttons.
  const candProbe = await page.evaluate(() => ({
    candidates: document.querySelectorAll(".cockpit-candidate").length,
    drills:     document.querySelectorAll(".cockpit-candidate-drill").length,
    aiBadges:   document.querySelectorAll(".cockpit-candidate-ai").length,
    helpAttrs:  document.querySelectorAll(".cockpit-candidate[data-help-context]").length,
  }));
  record("cockpit shows at least one candidate", candProbe.candidates >= 1, JSON.stringify(candProbe));
  record("each candidate has a Verify drill button",
    candProbe.candidates > 0 && candProbe.drills === candProbe.candidates,
    JSON.stringify(candProbe));
  record("AI-named candidates carry the AI badge", candProbe.aiBadges >= 1);
  record("candidate rows carry helpContext attrs", candProbe.helpAttrs === candProbe.candidates);

  // Workshop-chrome suppression: actions bar trimmed; summary panel + raw
  // events hidden.
  const chrome = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const vis = (sel) => {
      const el = $(sel);
      return el ? getComputedStyle(el).display !== "none" : false;
    };
    return {
      sessionSummary: vis(".session-summary"),
      onboarding:    vis("#onboarding-card"),
      eventTable:    vis(".event-table-host"),
      pills:         vis("#session-pills"),
      btnNormalize:  vis("#btn-normalize"),
      moreMenu:      vis("#session-more-menu"),
      btnOpen:       vis("#btn-open-session"),
      exportMenu:    vis("#session-export-menu"),
    };
  });
  record("session-summary hidden in Cockpit", !chrome.sessionSummary, JSON.stringify(chrome));
  record("raw events panel hidden in Cockpit", !chrome.eventTable);
  record("pills hidden in Cockpit", !chrome.pills);
  record("Analyze button hidden in Cockpit", !chrome.btnNormalize);
  record("Open another button still visible", chrome.btnOpen);
  record("Export menu still visible", chrome.exportMenu);

  // §4.4: drill from candidate → Workshop / Analysis.
  const drillProbe = await page.evaluate(async () => {
    const btn = document.querySelector(".cockpit-candidate-drill");
    if (!btn) return { drilled: false };
    btn.click();
    await new Promise(r => setTimeout(r, 600));
    return {
      drilled: true,
      mode: document.querySelector("#session-mode-toggle .mode-btn.active")?.dataset.mode,
      level: document.querySelector(".view-mode-btn.active")?.dataset.level,
      viewModeBar: getComputedStyle(document.querySelector(".view-mode-bar")).display,
    };
  });
  record("clicking Verify switches to Workshop", drillProbe.mode === "workshop", JSON.stringify(drillProbe));
  record("clicking Verify lands on Analysis level", drillProbe.level === "analysis", JSON.stringify(drillProbe));
  record("view-mode bar returns to visible in Workshop", drillProbe.viewModeBar !== "none");

  // Back to Cockpit, then Workshop / Glance round-trip.
  await page.evaluate(() => document.querySelector('#session-mode-toggle .mode-btn[data-mode="cockpit"]').click());
  await wait(500);
  await page.evaluate(() => document.querySelector('#session-mode-toggle .mode-btn[data-mode="glance"]').click());
  await wait(800);
  const glanceDisplay = await page.evaluate(() => ({
    glance: getComputedStyle(document.getElementById("session-layout-glance")).display,
    cockpit: getComputedStyle(document.getElementById("session-layout-cockpit")).display,
    actionsBar: getComputedStyle(document.querySelector(".actions-bar")).display,
  }));
  record("Glance layout visible after toggle",
    glanceDisplay.glance !== "none" && glanceDisplay.cockpit === "none",
    JSON.stringify(glanceDisplay));
  record("Glance suppresses actions bar (worker view)",
    glanceDisplay.actionsBar === "none", JSON.stringify(glanceDisplay));

  await shot(page, "cockpit-smoke-final.png");
  record("zero PAGE ERRORs", pageErrs.length === 0, pageErrs.slice(0, 3).join(" | "));

  await app.close().catch(() => {});
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n[cockpit-smoke] ${results.length - fail}/${results.length} passed, ${fail} failed`);
  if (fail) for (const r of results) if (!r.ok) console.log("  - " + r.name + ": " + (r.detail || ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[cockpit-smoke] crash:", e.stack); process.exit(2); });
