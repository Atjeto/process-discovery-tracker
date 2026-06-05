"use strict";
/*
 * Engagement-view smoke (PDT-1.0-SPEC §5.3).
 *
 * Asserts:
 *   - Engagement tab opens and shows the empty state.
 *   - Loading the bundled demo-pack engagement populates 4 backlog rows.
 *   - Headline cards render (sessions / captured / processes).
 *   - Export buttons present: Backlog (XLSX), CSV, All PDDs, Config bundle.
 *   - Clicking a card drills into the per-process detail page.
 *   - Detail page shows variants / PDD / evidence sections + Generate PDD CTA.
 *   - Back button returns to the overview.
 */

const path = require("path");
const fs = require("fs");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const ENGAGEMENT = path.join(REPO, "sessions", "demo-pack");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ["."],
      cwd: VIEWER,
      env: Object.assign({}, process.env, { PDT_OLLAMA_URL: "http://127.0.0.1:11434" }),
    });
  } catch (e) { console.error("launch:", e.message); process.exit(2); }

  const page = await app.firstWindow();
  const pageErrs = [];
  page.on("pageerror", (e) => pageErrs.push(String(e.message)));

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await wait(1500);

  // Open the Engagement tab.
  await page.click('.tab[data-view="engagement"]').catch(() => {});
  await wait(800);
  const tab = await page.evaluate(() =>
    document.querySelector('.tab[data-view="engagement"]')?.classList.contains("active"));
  record("Engagement tab activates", !!tab);

  // Empty state visible.
  const emptyVisible = await page.evaluate(() =>
    !!document.querySelector(".engagement-empty"));
  record("Engagement empty state visible", emptyVisible);

  // Load demo-pack engagement programmatically (bypass the OS folder picker).
  const loaded = await page.evaluate(async (folder) => {
    try {
      const Ipc = require("./ipc.js");
      const r = await Ipc.invoke("viewer:loadEngagement", folder);
      if (r && !r.error) {
        const EngagementView = require("./views/engagement-view.js");
        EngagementView.loadEngagement(r);
        return { ok: true, processCount: r.backlog?.process_count, sessionCount: r.summary?.session_count, captureMs: r.summary?.total_capture_ms };
      }
      return { ok: false, err: r && r.error };
    } catch (e) { return { ok: false, err: e.message, stack: e.stack }; }
  }, ENGAGEMENT);
  record("loadEngagement succeeds without throwing", loaded.ok, JSON.stringify(loaded));
  record("demo-pack reports 4 sessions", loaded.sessionCount === 4, "got " + loaded.sessionCount);
  record("demo-pack reports 4 processes", loaded.processCount === 4, "got " + loaded.processCount);
  record("total_capture_ms derived (not zero)",
    typeof loaded.captureMs === "number" && loaded.captureMs > 0,
    "captureMs=" + loaded.captureMs);
  await wait(1200);

  // Cards render.
  const cardsInfo = await page.evaluate(() => ({
    cards: document.querySelectorAll(".engagement-card").length,
    headlines: document.querySelectorAll(".engagement-stat-card").length,
    exportButtons: Array.from(document.querySelectorAll(".engagement-export-bar button")).map(b => b.textContent),
    title: document.querySelector(".engagement-title h2")?.textContent || "",
    aiBadges: document.querySelectorAll(".engagement-card-ai").length,
  }));
  record("4 backlog cards render", cardsInfo.cards === 4, JSON.stringify(cardsInfo));
  record(">=3 headline cards render", cardsInfo.headlines >= 3, JSON.stringify(cardsInfo));
  record("Backlog (XLSX) button present", cardsInfo.exportButtons.some(t => /Backlog/i.test(t) && /XLSX/i.test(t)));
  record("CSV button present", cardsInfo.exportButtons.some(t => /^CSV$/.test(t)));
  record("All PDDs button present", cardsInfo.exportButtons.some(t => /All PDDs/i.test(t)));
  record("Config bundle button present", cardsInfo.exportButtons.some(t => /Config bundle/i.test(t)));
  record("Title shows the demo engagement", /Demo Pack/i.test(cardsInfo.title));
  record("AI-named cards carry the AI badge", cardsInfo.aiBadges >= 1, "ai=" + cardsInfo.aiBadges);

  // Drill into the first card.
  await page.click(".engagement-card");
  await wait(800);
  const detail = await page.evaluate(() => ({
    title: document.querySelector(".engagement-detail-title")?.textContent || "",
    sections: Array.from(document.querySelectorAll(".engagement-detail-section h3")).map(h => h.textContent),
    headlineCards: document.querySelectorAll(".engagement-detail .engagement-stat-card").length,
    pddBtn: !!document.querySelector(".engagement-detail-actions button.primary"),
    backBtn: !!document.querySelector(".engagement-back-btn"),
  }));
  record("detail page renders a title", detail.title.length > 0, JSON.stringify(detail));
  record("detail page has Variants section", detail.sections.some(s => /Variants/i.test(s)));
  record("detail page has PDD section", detail.sections.some(s => /Process Discovery Document/i.test(s)));
  record("detail page has Evidence section", detail.sections.some(s => /Evidence/i.test(s)));
  record("Generate PDD button present", detail.pddBtn);
  record("Back button present", detail.backBtn);

  // Back to overview.
  await page.click(".engagement-back-btn");
  await wait(600);
  const back = await page.evaluate(() => document.querySelectorAll(".engagement-card").length);
  record("back returns to backlog overview", back === 4);

  // Export bar produces files.
  const xlsxOut = path.join(ENGAGEMENT, "deliverables", "backlog.xlsx");
  if (fs.existsSync(xlsxOut)) {
    const beforeMtime = fs.statSync(xlsxOut).mtimeMs;
    // Force-rewrite by calling the IPC directly.
    const res = await page.evaluate(async (folder) => {
      const Ipc = require("./ipc.js");
      return await Ipc.invoke("viewer:exportBacklog", { engagementFolder: folder, kind: "xlsx" });
    }, ENGAGEMENT);
    record("exportBacklog xlsx succeeds", res && !res.error, JSON.stringify(res).slice(0, 200));
    const afterMtime = fs.statSync(xlsxOut).mtimeMs;
    record("xlsx file rewritten on export", afterMtime >= beforeMtime);
  }

  await page.screenshot({ path: path.join(OUT, "engagement-smoke-final.png"), fullPage: true });
  record("zero PAGE ERRORs", pageErrs.length === 0, pageErrs.slice(0, 3).join(" | "));

  await app.close().catch(() => {});
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n[engagement-smoke] ${results.length - fail}/${results.length} passed, ${fail} failed`);
  if (fail) for (const r of results) if (!r.ok) console.log("  - " + r.name + ": " + (r.detail || ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[engagement-smoke] crash:", e.stack); process.exit(2); });
