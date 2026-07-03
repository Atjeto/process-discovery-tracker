"use strict";
/*
 * Case-tree / work-items e2e smoke (ADR-0028, APPROACHABILITY-REDESIGN §5 R3).
 *
 * Launches the REAL viewer against a TEMP copy of the committed demo whose
 * events.jsonl is SEEDED with a synthetic revisit (a couple of Excel events
 * appended inside case "Order #10900" AFTER it moved on to Outlook), so one
 * case genuinely bounces back to a screen it already visited. The demo's own 4
 * cases never revisit a screen (measured), so without this seed no work item
 * would fold >1 visit — the seed makes the non-consecutive merge observable.
 *
 * Asserts:
 *   - the Steps view default (screen notch) renders the CASE TREE — cases with
 *     work-item children (not the ADR-0024 .step-row roll-up);
 *   - at least one work item folds a multi-visit (visited 2× · N steps) — the
 *     seeded revisit;
 *   - renaming a work item writes group_annotations to annotations.json, and
 *     the name SURVIVES an in-app re-analyze (STEP 1's preservation guarantee);
 *   - the renamed group's name flows down to its member's timeline step band.
 *
 * Writes ONLY into its own temp dir; the committed demo is copied, never
 * mutated. Exits non-zero on any regression. Mirrors workbench-smoke.js.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const OUT = __dirname;
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}

/* Copy the demo to temp and seed a synthetic revisit into events.jsonl: two
   Excel value_changed events at 09:01:00/01Z, inside case #10900 (marker start
   09:00:19 → end 09:01:02) but AFTER its Outlook block (09:00:59). Result: case
   #10900 visits Excel, moves to Outlook, then bounces back to Excel — a
   non-consecutive revisit the work-item merge folds (visit_count 2). */
function seedSession() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-wi-"));
  for (const f of fs.readdirSync(SRC_SESSION)) {
    const s = path.join(SRC_SESSION, f);
    try { if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(tmp, f)); } catch (_) {}
  }
  const jsonlPath = path.join(tmp, "events.jsonl");
  const lines = fs.readFileSync(jsonlPath, "utf-8").split("\n").filter((l) => l.trim());
  const evs = lines.map((l) => JSON.parse(l));
  // Find an Excel interaction to clone its shape (process/window/data schema).
  const excel = evs.find((e) => e.type === "interaction" &&
    (e.data || {}).window_title === "Excel - Order Tracking.xlsx");
  if (!excel) throw new Error("seed: no Excel interaction to clone");
  const mk = (ts, idn) => {
    const c = JSON.parse(JSON.stringify(excel));
    c.event_id = "seed-revisit-" + idn;
    c.timestamp = ts;
    c.data.kind = "value_changed";
    return c;
  };
  const seeded = [mk("2026-05-14T09:01:00Z", "a"), mk("2026-05-14T09:01:01Z", "b")];
  // Insert in timestamp order (right before the 09:01:02Z marker end).
  const out = [];
  let inserted = false;
  for (const e of evs) {
    if (!inserted && new Date(e.timestamp).getTime() >= new Date("2026-05-14T09:01:00Z").getTime()) {
      out.push(...seeded); inserted = true;
    }
    out.push(e);
  }
  if (!inserted) out.push(...seeded);
  fs.writeFileSync(jsonlPath, out.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  // Analyze the seeded session so the viewer opens on current output.
  const bundled = path.join(VIEWER, "python", "python.exe");
  const pys = fs.existsSync(bundled) ? [bundled] : ["python", "python3"];
  const norm = path.join(REPO, "normalization", "normalize.py");
  let analyzed = false;
  for (const py of pys) {
    try { execFileSync(py, [norm, tmp, "--mine"], { cwd: REPO, stdio: "ignore" }); analyzed = true; break; }
    catch (_) { /* next */ }
  }
  return { tmp, analyzed };
}

(async () => {
  const { tmp, analyzed } = seedSession();
  if (!analyzed) {
    console.log("[workitems-e2e] FATAL: no pipeline-bearing Python to analyze the seeded session");
    process.exit(2);
  }

  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath, args: [".", "--session=" + tmp], cwd: VIEWER,
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
  await wait(1500);

  // ---- Steps view default = the case tree -------------------------------
  await page.click('.view-mode-btn[data-level="steps"]').catch(() => {});
  await wait(900);
  const tree = await page.evaluate(() => {
    const heads = [...document.querySelectorAll("#step-list .wi-case-head")];
    return { cases: heads.length, hasStepRow: !!document.querySelector("#step-list .step-row") };
  }).catch(() => ({ cases: 0, hasStepRow: true }));
  record("Steps default renders the case tree (cases, not the ADR-0024 step roll-up)",
    tree.cases >= 4 && !tree.hasStepRow,
    "cases=" + tree.cases + " hasStepRow=" + tree.hasStepRow);
  if (tree.cases < 4) { await shot(page, "fail-wi-tree.png"); await app.close().catch(() => {}); process.exit(1); }

  // Expand every case, then look for a multi-visit work item.
  const caseN = tree.cases;
  for (let i = 0; i < caseN; i++) {
    await page.evaluate((idx) => {
      const h = document.querySelectorAll("#step-list .wi-case-head")[idx];
      if (h && !h.classList.contains("open")) h.click();
    }, i).catch(() => {});
    await wait(150);
  }
  const fold = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#step-list .wi-item-row")];
    const visited = rows.map((r) => (r.querySelector(".wi-visits")?.textContent || "").trim())
      .filter((t) => /visited\s+\d+×/.test(t));
    return { items: rows.length, multiVisit: visited };
  }).catch(() => ({ items: 0, multiVisit: [] }));
  record("a work item folds a multi-visit revisit (visited N×)", fold.multiVisit.length >= 1,
    "work items=" + fold.items + " multi-visit=" + JSON.stringify(fold.multiVisit));
  if (!fold.multiVisit.length) await shot(page, "fail-wi-fold.png");

  // ---- Rename a work item -> persists -> survives re-analyze -------------
  // Select the FIRST work item (deterministic: the first case's first item),
  // rename it, save.
  const NEW_NAME = "Renamed by R3 smoke";
  const selected = await page.evaluate(() => {
    const r = document.querySelector("#step-list .wi-item-row");
    if (!r) return null;
    r.click();
    return { screenKey: r.getAttribute("data-screen-key"), caseKey: r.getAttribute("data-case-key") };
  }).catch(() => null);
  await wait(500);
  let renamed = false;
  if (selected) {
    renamed = await page.evaluate((nm) => {
      const inp = document.querySelector("#wi-name");
      const btn = document.querySelector("#wi-save");
      if (!inp || !btn) return false;
      inp.value = nm; inp.dispatchEvent(new Event("input", { bubbles: true }));
      btn.click();
      return true;
    }, NEW_NAME).catch(() => false);
  }
  await wait(900);
  // The name must be in annotations.json group_annotations on disk.
  let onDisk = false, entry = null;
  try {
    const anno = JSON.parse(fs.readFileSync(path.join(tmp, "annotations.json"), "utf-8"));
    entry = (anno.group_annotations || []).find((g) => g && g.name === NEW_NAME);
    onDisk = !!entry;
  } catch (_) { onDisk = false; }
  record("renaming a work item persists to annotations.json group_annotations",
    renamed && onDisk,
    onDisk ? "keyed {case_id:" + (entry.case_id || "null") + ", screen_key:" + entry.screen_key + "}"
           : "no matching group_annotations entry on disk");

  // Re-analyze in-app (the header Analyze button) and confirm the name survives.
  await page.click("#btn-normalize").catch(() => {});
  await wait(3500);
  let survived = false;
  try {
    const anno = JSON.parse(fs.readFileSync(path.join(tmp, "annotations.json"), "utf-8"));
    survived = (anno.group_annotations || []).some((g) => g && g.name === NEW_NAME);
  } catch (_) { survived = false; }
  record("the work-item name survives an in-app re-analyze (pipeline-preserved)", survived,
    survived ? "" : "group_annotations name lost after re-analyze");

  // ---- Flow-down: the renamed group's name shows on its member timeline band.
  await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
  await wait(1200);
  const bandShowsName = await page.evaluate((nm) => {
    // Ensure the per-step lane is on (it flows the group name via grainLabel).
    try { require("./views/flow-view-timeline.js").setLaneToggle("steps", true); } catch (_) {}
    // Nudge a re-render of the flow timeline.
    const flowBtn = document.querySelector('.view-mode-btn[data-level="flow"]');
    if (flowBtn) flowBtn.click();
    return new Promise((res) => setTimeout(() => {
      const bands = [...document.querySelectorAll(".tl-step-band")].map((b) => (b.textContent || "").trim());
      res({ any: bands.some((t) => t === nm), sample: bands.slice(0, 8) });
    }, 900));
  }, NEW_NAME).catch(() => ({ any: false, sample: [] }));
  record("the renamed group's name flows down to its member's timeline step band",
    bandShowsName.any, bandShowsName.any ? "" : "bands=" + JSON.stringify(bandShowsName.sample));
  if (!bandShowsName.any) await shot(page, "fail-wi-flowdown.png");

  record("zero PAGE ERRORs", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await app.close().catch(() => {});
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[workitems-e2e] ${passed}/${results.length} checks passed, ${results.length - passed} failed`);
  if (passed !== results.length) {
    console.log("[workitems-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + (r.detail ? "  — " + r.detail : ""));
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("FATAL", e && e.stack ? e.stack : e); process.exit(2); });
