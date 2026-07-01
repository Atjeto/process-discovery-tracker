"use strict";
/*
 * Flywheel e2e smoke (lab-phase spec §D4) — the Phase D merge gate.
 *
 * Proves the template flywheel end-to-end in the REAL viewer:
 *   curate demo session 1 → export a Process Template (carrying the
 *   accepted case anchor) → load demo session 2 with the template →
 *   session 2 arrives SELF-SEGMENTED (anchor inherited via template,
 *   no per-session Accept) + auto-matched → Compare leads with ≥ 1
 *   variant_divergence finding on the pair.
 *
 * Checks:
 *   (a) marker-stripped session 1 shows the anchor hero; Accept + a
 *       re-analyze flips the badge to "✓ Anchor … cases" (curated);
 *   (b) Steps → "Export as Process Template" writes a YAML whose
 *       canonical_process carries BOTH the case_anchor and match-ruled
 *       steps (the §D3 byproduct);
 *   (c) session 2 (raw, marker-stripped) matched against that template
 *       through the UI case-segments via the INHERITED anchor —
 *       case_quality.mode == "anchor", tier2 unlocked, and NO
 *       case_anchor_override in its annotations;
 *   (d) ≥ 1 auto_matched step lands in session 2's annotations;
 *   (e) Compare (both sessions loaded) leads with the cross-session
 *       findings feed: ≥ 1 variant_divergence card (claim printed for
 *       the report), the aligned reading renders backbone rows, and the
 *       merged map sits BELOW the findings panel (the §D2 demotion);
 *   (f) zero PAGE ERRORs across both launches.
 *
 * Screenshots (gitignored): flywheel-session2-badge.png,
 * compare-divergence-state.png.
 *
 * Like overview-smoke it re-normalizes TEMP copies so the committed
 * demo is never touched, and reuses the viewer's own Electron. A
 * missing deps-bearing Python is a HARD FAIL — every assertion depends
 * on current pipeline output.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC_A = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0511-0905");
const SRC_B = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0511-1320");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const yaml = require(path.join(VIEWER, "node_modules", "js-yaml"));
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

/* Marker-stripped temp copy of a demo session — the shape a passive
   capture has when the worker fired no markers (the flywheel's input).
   Raw source files are only ever READ. */
function makeTempSession(src) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-fly-e2e-"));
  const events = fs.readFileSync(path.join(src, "events.jsonl"), "utf-8")
    .split(/\r?\n/).filter((line) => {
      const t = line.trim();
      if (!t) return false;
      try { return JSON.parse(t).type !== "marker"; }
      catch (_) { return true; }
    }).join("\n") + "\n";
  fs.writeFileSync(path.join(tmp, "events.jsonl"), events);
  fs.copyFileSync(path.join(src, "manifest.json"), path.join(tmp, "manifest.json"));
  return tmp;
}

function normalize(sessionDir, canonicalPath) {
  const norm = path.join(REPO, "normalization", "normalize.py");
  const args = [norm, sessionDir, "--mine"];
  if (canonicalPath) args.push("--canonical", canonicalPath);
  let lastErr = null;
  for (const py of resolvePython()) {
    try {
      execFileSync(py, args, { cwd: REPO, stdio: "ignore" });
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

/* Poll until fn() resolves truthy or the deadline passes. */
async function until(fn, timeoutMs, stepMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = null;
    try { v = await fn(); } catch (_) { v = null; }
    if (v) return v;
    await wait(stepMs);
  }
  return null;
}

(async () => {
  // ---- Prepare: temp copies; session 1 analyzed (no template) -------------
  const SESSION_A = makeTempSession(SRC_A);
  const SESSION_B = makeTempSession(SRC_B);
  const TPL_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pdt-fly-tpl-")),
    "flywheel-order-process.yaml");
  if (!normalize(SESSION_A) || !normalize(SESSION_B)) {
    record("prepare session 1 (prerequisite)", false, "no deps-bearing Python");
    process.exit(1);
  }

  const pageErrors = [];

  // ================= Launch 1: curate session 1 + export the template =====
  let app, page;
  try {
    ({ app, page } = await launch(SESSION_A, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (item 11) Compare empty state, BEFORE session 1 is curated: both raw
  // sessions are still unsegmented, so Compare's cross-session findings
  // panel hits the "not confirmed cases of the same process" precondition --
  // one resident sentence, a "Why these sessions don't compare yet"
  // disclosure, and a real CTA button (not a prose pointer) to a session's
  // Overview. Uses the same #btn-open-multi-hero load path as (e) below.
  await app.evaluate(({ dialog }, folders) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: folders });
  }, [SESSION_A, SESSION_B]);
  await page.evaluate(() => document.querySelector('.tab[data-view="aggregate"]').click());
  await wait(300);
  await page.evaluate(() => document.querySelector("#btn-open-multi-hero").click());
  const compareEmpty = await until(() => page.evaluate(() => {
    const panel = document.getElementById("agg-findings-panel");
    if (!panel || getComputedStyle(panel).display === "none") return null;
    const note = panel.querySelector(".analysis-note");
    const details = panel.querySelector(".agg-findings-why");
    const cta = panel.querySelector('[data-agg-cta="overview"]');
    if (!note || !details || !cta) return null;
    return {
      noteLen: (note.textContent || "").trim().length,
      hasDisclosure: !!details,
      summaryText: (details.querySelector("summary") || {}).textContent || "",
      ctaIsButton: cta.tagName === "BUTTON",
      ctaText: (cta.textContent || "").trim(),
    };
  }), 60000);
  record("(item 11) Compare empty state: one sentence + disclosure + a real CTA button",
    !!(compareEmpty && compareEmpty.noteLen > 0 && compareEmpty.noteLen < 200 &&
      compareEmpty.hasDisclosure && compareEmpty.ctaIsButton && compareEmpty.ctaText.length > 0),
    JSON.stringify(compareEmpty));
  if (!compareEmpty) await shot(page, "fail-compare-empty-state.png");
  // Exercise the CTA: it must switch to the Session tab, load that session,
  // and land on its Overview (not merely "some level").
  await page.evaluate(() => document.querySelector('[data-agg-cta="overview"]').click());
  const ctaLanded = await until(() => page.evaluate(() => {
    const activeTab = document.querySelector(".tab.active");
    const activeLevel = document.querySelector(".view-mode-btn.active");
    return {
      tab: activeTab ? activeTab.dataset.view : null,
      level: activeLevel ? activeLevel.dataset.level : null,
      overviewVisible: !!document.getElementById("overview-content") &&
        getComputedStyle(document.getElementById("session-layout-overview")).display !== "none",
    };
  }), 15000);
  record("(item 11) the CTA switches to Session view, Overview level",
    !!(ctaLanded && ctaLanded.tab === "session" && ctaLanded.level === "overview" &&
      ctaLanded.overviewVisible),
    JSON.stringify(ctaLanded));

  // (a) The anchor hero renders on the unsegmented copy; Accept the top
  // candidate, then re-run Analyze (the accept path's documented inverse
  // lives in the Markers panel; the hero is the same wiring).
  const heroRows = await page.evaluate(() =>
    document.querySelectorAll('#overview-content .ov-hero-row [data-act="accept"]').length);
  await page.evaluate(() => {
    const btn = document.querySelector('#overview-content .ov-hero-row [data-act="accept"]');
    if (btn) btn.click();
  });
  await wait(800);
  await page.evaluate(() => document.querySelector("#btn-normalize").click());
  await wait(400);
  // H7 guard: re-analyzing a session that already has steps asks first.
  await page.evaluate(() => {
    const ok = document.querySelector(".modal-confirm .modal-ok");
    if (ok) ok.click();
  });
  const anchorBadge = await until(() => page.evaluate(() => {
    const b = document.querySelector("#overview-content .ov-badge");
    const t = b ? (b.textContent || "").trim() : "";
    return /✓ \d+ cases? — identified by/.test(t) ? t : null;
  }), 120000);
  record("(a) session 1: anchor hero Accept + re-analyze → ✓ Anchor badge",
    !!(heroRows >= 1 && anchorBadge),
    "heroRows=" + heroRows + " badge=" + JSON.stringify(anchorBadge));

  // (b) Steps → Export as Process Template. Stub the save dialog to the
  // temp template path, type a name into the prompt modal, create, and
  // decline the "open the template tab" follow-up.
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, TPL_PATH);
  await page.evaluate(() => document.querySelector('.view-mode-btn[data-level="steps"]').click());
  await wait(600);
  await page.evaluate(() => document.querySelector("#btn-steps-to-template").click());
  const promptSeen = await until(() => page.evaluate(() => {
    const input = document.querySelector(".modal-prompt .modal-input");
    if (!input) return null;
    input.value = "Flywheel Order Process";
    document.querySelector(".modal-prompt .modal-ok").click();
    return true;
  }), 10000);
  // Decline "Open the new template?" so we stay on the session.
  await until(() => page.evaluate(() => {
    const cancel = document.querySelector(".modal-confirm .modal-cancel");
    if (!cancel) return null;
    cancel.click();
    return true;
  }), 10000);
  const tplOk = await until(() => {
    if (!fs.existsSync(TPL_PATH)) return null;
    try {
      const doc = yaml.load(fs.readFileSync(TPL_PATH, "utf-8"));
      const proc = (doc || {}).canonical_process || {};
      const anchor = proc.case_anchor || {};
      const ruled = (proc.steps || []).filter((s) => (s.match || []).length).length;
      if (anchor.field && ruled >= 1) {
        return { anchor, steps: (proc.steps || []).length, ruled };
      }
    } catch (_) {}
    return null;
  }, 15000);
  record("(b) template exported WITH the accepted case_anchor + match-ruled steps",
    !!(promptSeen && tplOk),
    tplOk ? "anchor=" + JSON.stringify(tplOk.anchor) + " steps=" + tplOk.steps +
      " ruled=" + tplOk.ruled : "template missing/anchor-less at " + TPL_PATH);

  await app.close().catch(() => {});

  // Apples-to-apples for the Compare reading: re-match session 1 against
  // the exported template (the same engine the viewer's Match button runs;
  // the UI path itself is exercised on session 2 below).
  if (!normalize(SESSION_A, TPL_PATH)) {
    record("re-match session 1 against the template (prerequisite)", false, "");
    process.exit(1);
  }

  // ================= Launch 2: session 2 arrives + Compare ================
  let app2, page2;
  try {
    ({ app: app2, page: page2 } = await launch(SESSION_B, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (session 2):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (c)+(d) Match the RAW second session against the template through the
  // UI. The anchor must be inherited from the template — no per-session
  // override, no Accept click on this session.
  await app2.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, TPL_PATH);
  await page2.evaluate(() => document.querySelector("#btn-match-template").click());
  const badge2 = await until(() => page2.evaluate(() => {
    const b = document.querySelector("#overview-content .ov-badge");
    const t = b ? (b.textContent || "").trim() : "";
    return /✓ \d+ cases? — identified by/.test(t) ? t : null;
  }), 120000);
  let cq2 = null, anno2 = null;
  try {
    cq2 = (JSON.parse(fs.readFileSync(path.join(SESSION_B, "analysis.json"), "utf-8"))
      || {}).case_quality || null;
    anno2 = JSON.parse(fs.readFileSync(path.join(SESSION_B, "annotations.json"), "utf-8"));
  } catch (_) {}
  const inherited = !!(cq2 && cq2.mode === "anchor" && cq2.tier2_unlocked &&
    cq2.case_count >= 2 && !(anno2 && anno2.case_anchor_override));
  record("(c) session 2 SELF-SEGMENTS via the inherited template anchor (no override, Tier 2)",
    !!(badge2 && inherited),
    "badge=" + JSON.stringify(badge2) + " case_quality=" + JSON.stringify(cq2) +
    " override=" + JSON.stringify(anno2 && anno2.case_anchor_override));
  const autoMatched = ((anno2 && anno2.steps) || [])
    .filter((s) => s && s.state === "auto_matched").length;
  record("(d) session 2 carries ≥ 1 auto_matched step from the template",
    autoMatched >= 1, autoMatched + " auto_matched step(s)");
  await shot(page2, "flywheel-session2-badge.png");

  // (e) Compare: load BOTH sessions, assert the reframed surface — the
  // divergence findings feed on top (≥ 1 variant_divergence card), the
  // aligned reading below it, the merged map demoted below both.
  await app2.evaluate(({ dialog }, folders) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: folders });
  }, [SESSION_A, SESSION_B]);
  await page2.evaluate(() => document.querySelector('.tab[data-view="aggregate"]').click());
  await wait(600);
  await page2.evaluate(() => document.querySelector("#btn-open-multi-hero").click());
  const compare = await until(() => page2.evaluate(() => {
    const panel = document.getElementById("agg-findings-panel");
    if (!panel || getComputedStyle(panel).display === "none") return null;
    const cards = [...panel.querySelectorAll(".ov-finding")];
    const dCards = cards.filter((c) => (c.dataset.fid || "").startsWith("variant_divergence-"));
    if (!dCards.length) return null;
    const claim = dCards[0].querySelector(".ov-finding-claim");
    const aligned = document.getElementById("agg-aligned-panel");
    const alignedVisible = !!(aligned && getComputedStyle(aligned).display !== "none");
    const backboneRows = document.querySelectorAll("#agg-aligned-content .backbone-row").length;
    // §D2 demotion geometry: the findings panel must sit ABOVE the merged
    // map panel (the .panel-wide that hosts #bpmn-host / #dfg-host).
    const mapPanel = document.getElementById("bpmn-host") &&
      document.getElementById("bpmn-host").closest(".panel");
    const fTop = panel.getBoundingClientRect().top;
    const mTop = mapPanel ? mapPanel.getBoundingClientRect().top : Infinity;
    return {
      divergenceCards: dCards.length,
      claim: claim ? (claim.textContent || "").trim() : "",
      alignedVisible,
      backboneRows,
      findingsAboveMap: fTop < mTop,
    };
  }), 60000);
  record("(e) Compare leads with ≥ 1 variant_divergence finding card",
    !!(compare && compare.divergenceCards >= 1 && compare.claim.length > 40),
    compare ? compare.divergenceCards + " card(s)" : "feed missing");
  record("(e2) aligned reading renders backbone rows on the pair",
    !!(compare && compare.alignedVisible && compare.backboneRows >= 1),
    compare ? compare.backboneRows + " row(s)" : "");
  record("(e3) merged map is demoted BELOW the findings feed",
    !!(compare && compare.findingsAboveMap), "");
  if (compare && compare.claim) {
    console.log("\n[e2e] divergence claim (memo candidate):\n      " + compare.claim + "\n");
  }
  await shot(page2, "compare-divergence-state.png");

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
