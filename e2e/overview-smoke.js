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
 *   (c) the fact strip renders 6 non-empty tiles (and none is clipped —
 *       scrollWidth must not exceed clientWidth; labels have drifted
 *       before, see e1f5680);
 *   (d) on a marker-STRIPPED re-normalized temp copy the anchor hero
 *       renders with >= 1 candidate (the unsegmented call to action);
 *   (e) the memo export button produces a non-empty <session>/memo.md;
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

  // (b) Case-quality badge: markers state on the 4-case demo.
  const badge = await page.evaluate(() => {
    const b = document.querySelector("#overview-content .ov-badge");
    const t2 = document.querySelector("#overview-content .ov-tier2");
    return {
      text: b ? (b.textContent || "").trim() : null,
      ok: !!(b && b.classList.contains("ok")),
      tier2: t2 ? (t2.textContent || "").trim() : null,
    };
  }).catch((e) => ({ err: e.message }));
  const badgeOk = !!(badge && !badge.err && badge.ok &&
    /✓ \d+ cases? — marked by the worker/.test(badge.text || "") &&
    /case analysis on/i.test(badge.tier2 || ""));
  record("(b) badge shows the worker-marked state + case analysis on", badgeOk, JSON.stringify(badge));

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

  // Findings feed sanity on the demo (claims + at least one memo checkbox).
  const feed = await page.evaluate(() => ({
    findings: document.querySelectorAll("#overview-content .ov-finding").length,
    memoChecks: document.querySelectorAll('#overview-content [data-act="memo"]').length,
    showBtns: document.querySelectorAll('#overview-content [data-act="show"]').length,
  })).catch((e) => ({ err: e.message }));
  record("findings feed renders with memo checkboxes",
    !!(feed && !feed.err && feed.findings > 0 && feed.memoChecks === feed.findings),
    JSON.stringify(feed));

  // §C4: the data posture is displayed on the Overview header line
  // (default reviewable), the Copy-for-LLM button exists under it, and
  // sealing the posture REMOVES the button from the DOM (re-render).
  const posture = await page.evaluate(() => {
    const sel = document.querySelector("#ov-posture-select");
    return {
      present: !!sel, value: sel ? sel.value : null,
      copyBtn: document.querySelectorAll("#btn-ov-copy-llm").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("§C4: posture shown on the Overview header (default reviewable) + Copy-for-LLM present",
    !!(posture && !posture.err && posture.present && posture.value === "reviewable" && posture.copyBtn === 1),
    JSON.stringify(posture));
  const sealedOv = await page.evaluate(() => {
    const sel = document.querySelector("#ov-posture-select");
    sel.value = "sealed";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      copyBtn: document.querySelectorAll("#btn-ov-copy-llm").length,
      selValue: (document.querySelector("#ov-posture-select") || {}).value,
      memoBtn: document.querySelectorAll("#btn-ov-export-memo").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("§C4: sealed posture removes Copy-for-LLM from the Overview DOM (memo export unaffected)",
    !!(sealedOv && !sealedOv.err && sealedOv.copyBtn === 0 && sealedOv.selValue === "sealed" && sealedOv.memoBtn === 1),
    JSON.stringify(sealedOv));
  await page.evaluate(() => {
    const sel = document.querySelector("#ov-posture-select");
    sel.value = "reviewable";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => {});
  await wait(200);

  await shot(page, "overview-markers-state.png");

  // (e) Memo export: stub the shell reveal (no Explorer window in a gate),
  // click the button, poll for a non-empty memo.md.
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; }).catch(() => {});
  const memoPath = path.join(SESSION_MARKED, "memo.md");
  if (fs.existsSync(memoPath)) fs.unlinkSync(memoPath);
  await page.click("#btn-ov-export-memo").catch((e) => console.log("export click", e.message));
  let memoOk = false, memoDetail = "";
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (fs.existsSync(memoPath)) {
      const text = fs.readFileSync(memoPath, "utf-8");
      if (text.length > 200 && text.startsWith("# Findings memo")) {
        memoOk = true;
        memoDetail = text.length + " chars, starts with '# Findings memo'";
        break;
      }
    }
    await wait(500);
  }
  if (!memoOk) memoDetail = "memo.md missing or empty after 120s";
  record("(e) memo export writes a non-empty memo.md", memoOk, memoDetail);
  if (!memoOk) await shot(page, "fail-overview-memo.png");

  await app.close().catch(() => {});

  // ================= Launch 2: the marker-stripped copy (hero state) ======
  let app2, page2;
  try {
    ({ app: app2, page: page2 } = await launch(SESSION_STRIPPED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (stripped):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (d) Unsegmented badge + the anchor hero with >= 1 candidate row.
  const hero = await page2.evaluate(() => {
    const badge = document.querySelector("#overview-content .ov-badge");
    const rows = document.querySelectorAll("#overview-content .ov-hero-row");
    const accepts = document.querySelectorAll('#overview-content .ov-hero-row [data-act="accept"]');
    return {
      badgeText: badge ? (badge.textContent || "").trim() : null,
      badgeWarn: !!(badge && badge.classList.contains("warn")),
      heroRows: rows.length,
      acceptBtns: accepts.length,
    };
  }).catch((e) => ({ err: e.message }));
  const heroOk = !!(hero && !hero.err && hero.badgeWarn &&
    /No cases identified yet/.test(hero.badgeText || "") &&
    hero.heroRows >= 1 && hero.acceptBtns === hero.heroRows);
  record("(d) marker-stripped session: ⚠ no-cases badge + anchor hero with >= 1 candidate",
    heroOk, JSON.stringify(hero));
  if (!heroOk) await shot(page2, "fail-overview-hero.png");

  await shot(page2, "overview-unsegmented-state.png");

  // The existing levels must still be reachable from the new default.
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
