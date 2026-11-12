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
 *     (BPMN)" items each write their file (no As-Is copy chosen yet: the step
 *     BPMN, the image drawn by bpmn-js as the PDD draws it),
 *   - the chrome: one top bar (New, Open, the four levels, the status line,
 *     Export, Help, theme; no actions bar, no Analyze button, no More menu),
 *     New and Open two menus, no Transaction select (lane LANES: a
 *     transaction's band says "Transaction 1 · <label>" and that a
 *     double-click shows only it), the version in Help, the active level
 *     legible under the mouse,
 *   - Help opens on Getting started, the process managers' guide, which says
 *     what docs/HOW-TO.md says in the same words (lane HT),
 *   - the Overview's Applications and time: the PDD's section 6 as
 *     analysis.json holds it (lane CC, one source), the time of every
 *     transaction and of every system; no dot strip, no total, no editor,
 *   - every map export opens its folder at the file (the reveal is stubbed
 *     and its path checked),
 *   - the Timeline's side panel opens on Screenshots (no Notes), its
 *     thumbnails show local time, the moved controls are where they are used
 *     (with and without a video), and the Raw events drawer shows on the
 *     Timeline only,
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

/* The tasks a step BPMN's start event leads to, through its gateways (lane
   FX1), or null when the file cannot be read. */
function bpmnFirstTasks(file) {
  let xml;
  try { xml = fs.readFileSync(file, "utf-8"); } catch (_) { return null; }
  const proc = (/<bpmn:process[\s\S]*?<\/bpmn:process>/.exec(xml) || [""])[0];
  const kinds = {}, names = {}, out = {};
  for (const m of proc.matchAll(/<bpmn:(\w+)\s([^>]*?)\/?>/g)) {
    const id = (/\bid="([^"]+)"/.exec(m[2]) || [])[1];
    if (!id) continue;
    kinds[id] = m[1];
    const nm = /\bname="([^"]*)"/.exec(m[2]);
    if (nm) names[id] = nm[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    if (m[1] === "sequenceFlow") {
      const s = (/\bsourceRef="([^"]+)"/.exec(m[2]) || [])[1], t = (/\btargetRef="([^"]+)"/.exec(m[2]) || [])[1];
      (out[s] = out[s] || []).push(t);
    }
  }
  const start = Object.keys(kinds).find((id) => kinds[id] === "startEvent");
  if (!start) return null;
  const todo = (out[start] || []).slice(), seen = new Set(), tasks = [];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    if (/Gateway$/.test(kinds[n] || "")) todo.push(...(out[n] || []));
    else if (/^(task|userTask|manualTask|subProcess)$/.test(kinds[n] || "")) tasks.push(names[n]);
  }
  return tasks;
}

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: true }).catch((e) => console.log("shot fail", name, e.message));
}

/* Lane HT: docs/HOW-TO.md, the process managers' guide, as Help's Getting
   started must follow it: its sections (##), the everyday tasks (### under
   Everyday tasks), the first hour's acts (the bold lead of each numbered
   item), the glossary's words (the table's first column), and its whole text
   with the Markdown marks taken out. A block is a paragraph, a heading, a
   list item or a table row, its wrapped lines joined. */
function howToDoc() {
  const md = fs.readFileSync(path.join(REPO, "docs", "HOW-TO.md"), "utf-8").replace(/\r\n/g, "\n");
  const blocks = [];
  for (const line of md.split("\n")) {
    if (!line.trim()) { blocks.push(null); continue; }
    const opens = /^(#|\||- |\d+\. )/.test(line);
    const last = blocks[blocks.length - 1];
    if (opens || last == null || /^(#|\|)/.test(last)) blocks.push(line.trim());
    else blocks[blocks.length - 1] = last + " " + line.trim();
  }
  const heads = [], tasks = [], acts = [], rows = [];
  let section = null;
  for (const b of blocks.filter(Boolean)) {
    if (b.startsWith("## ")) { section = b.slice(3).trim(); heads.push(section); continue; }
    if (b.startsWith("### ") && section === "Everyday tasks") tasks.push(b.slice(4).trim());
    const act = section === "Your first hour" && /^\d+\. \*\*(.+?)\*\*/.exec(b);
    if (act) acts.push(act[1]);
    const row = section === "Glossary" && /^\|([^|]+)\|/.exec(b);
    if (row && !/^[\s:-]+$/.test(row[1])) rows.push(row[1].trim());
  }
  const plain = blocks.filter((b) => b && !/^\|[\s|:-]+\|$/.test(b)).join(" ")
    .replace(/\*/g, "").replace(/\|/g, " ").replace(/\s+/g, " ");
  return { heads, tasks, acts, terms: rows.slice(1), plain };   // rows[0] is the header row
}

/* Lane MV: the Map opens on the map the PDD prints, and analyzes first when
   the steps are newer than it. mapSettled waits until that analysis (and any
   other queued or running) has ended; showRuns then shows how the
   transactions ran, the live map the checks that read cytoscape read. */
async function mapSettled(page) {
  await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
    null, { timeout: 180000 });
}
async function showRuns(page) {
  await mapSettled(page);
  const link = page.locator("#btn-map-show-runs");
  if (await link.isVisible()) await link.click({ timeout: 20000 });
  await page.waitForFunction(() => {
    const h = document.getElementById("session-map-dfg-host");
    return !!(h && h.getClientRects().length && (h.__cy || h.querySelector(".map-empty-inline")));
  }, null, { timeout: 20000 });
  await wait(600);
}

// Per-level layout container that must become visible when its level is active
// (data-level "flow" is the Timeline). The Overview is checked on its own below.
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
  // Lane FX3 (validation pass 3, F27): a file attached after that backup,
  // which the backup names no entry for.
  fs.mkdirSync(path.join(dir, "attachments"));
  fs.writeFileSync(path.join(dir, "attachments", "sop.txt"), "the SOP, attached after the backup");
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
    /annotations\.json in this project folder cannot be read/.test(banner) && /annotations\.json\.2/.test(banner),
    banner.slice(0, 260));

  // Lane FX2 (validation pass 3, F12): the page is the banner alone, so the
  // project never looks empty and nothing offers an edit: no level, no
  // editing control, no Export, no step panel, no Raw events; New, Open, Help
  // and the theme stay.
  let only = null;
  try {
    only = await p.evaluate(() => {
      const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
      const loaded = document.getElementById("session-loaded");
      return {
        banner: vis(document.getElementById("annotations-error-banner")),
        levels: [...document.querySelectorAll(".view-mode-btn")].filter(vis).length,
        layouts: ["overview", "flow", "steps", "map"].filter((l) => vis(document.getElementById("session-layout-" + l))),
        edits: ["btn-add-manual-step", "btn-add-step", "btn-attach-video", "btn-attach-transcript", "btn-fork-refmap", "btn-ov-next"]
          .filter((id) => vis(document.getElementById(id))),
        exportMenu: vis(document.getElementById("btn-session-export-menu")),
        status: vis(document.getElementById("session-pills")), saveState: vis(document.getElementById("save-state")),
        stepPanel: vis(document.getElementById("step-panel")), rawEvents: vis(document.querySelector(".event-table-host")),
        stay: ["btn-new-menu", "btn-recent-menu", "btn-help", "btn-theme-toggle"].filter((id) => vis(document.getElementById(id))),
        emptyWords: /No video|No transcript|No steps yet|No transactions/.test(loaded ? loaded.innerText || "" : ""),
      };
    });
  } catch (e) { logActionError("FX2 unreadable page", e); only = { err: String(e.message).split("\n")[0] }; }
  record("lane FX2: with annotations.json unreadable the page is the banner alone: no level, no editing control, no Export, nothing that reads as an empty project; New, Open, Help and the theme stay",
    !!(only && !only.err && only.banner && only.levels === 0 && only.layouts.length === 0 && only.edits.length === 0 && !only.exportMenu &&
      !only.status && !only.saveState && !only.stepPanel && !only.rawEvents && only.stay.length === 4 && !only.emptyWords),
    JSON.stringify(only));
  if (!(only && only.levels === 0)) await shot(p, "fail-fx2-unreadable-page.png");

  // Nothing on the page edits now; the main process still refuses a save
  // through the one write path (session.js), with an error toast, and no
  // file may change (no write, no backup rotation).
  const toastText = () => p.$eval("#toast", (el) => el.className.includes("error") ? (el.textContent || "") : "");
  let saveMsg = "";
  try {
    await p.evaluate(async () => {
      const S = require("./session.js");
      try { await S.persistAnnotations(S.ensureAnnoShape({ steps: [] }), "insert start marker"); } catch (_) { /* shown as a toast */ }
    });
    await p.waitForFunction(() => /was not saved/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: T });
    saveMsg = await toastText();
  } catch (e) { logActionError("RP-04 save refused", e); saveMsg = "no refusal shown: " + String(e.message).split("\n")[0]; }
  const afterSave = untouched();
  record("RP-04: a save on that session is refused with an error naming the problem; annotations.json and its backups are untouched",
    /was not saved/.test(saveMsg) && /cannot be read/.test(saveMsg) && afterSave,
    "toast=" + JSON.stringify(saveMsg.slice(0, 200)) + " filesUntouched=" + afterSave);

  // Lane A-1: an error message is announced (role="alert") and stays while it
  // is read: still on screen after 5 s, gone on its Dismiss. Its text lets the
  // clicks through; only its buttons take them.
  const stays = {};
  try {
    await wait(5000);
    stays.at5s = await p.evaluate(() => {
      const el = document.getElementById("toast");
      const x = el.querySelector(".toast-close");
      return { shown: el.classList.contains("show") && el.classList.contains("error"), role: el.getAttribute("role"),
        live: el.getAttribute("aria-live"), dismiss: x ? x.getAttribute("aria-label") : null,
        textClicks: getComputedStyle(el).pointerEvents, buttonClicks: x ? getComputedStyle(x).pointerEvents : null };
    });
    await p.locator("#toast .toast-close").click({ timeout: T });
    await wait(150);
    stays.afterDismiss = await p.evaluate(() => document.getElementById("toast").classList.contains("show"));
  } catch (e) { logActionError("A-1 an error stays", e); stays.err = String(e.message).split("\n")[0]; }
  const s5 = stays.at5s || {};
  record("lane A-1: an error message is an alert that stays on screen past 5 s and goes on Dismiss; its text lets clicks through to the page",
    !stays.err && s5.shown && s5.role === "alert" && s5.live === "assertive" && s5.dismiss === "Dismiss" &&
      s5.textClicks === "none" && s5.buttonClicks === "auto" && stays.afterDismiss === false,
    JSON.stringify(stays));

  // AD-22: no analysis starts by itself over an unreadable annotations.json
  // (the banner says why; the pipeline would refuse). The one analysis by
  // hand, Help's Re-analyze, is refused with the reason, and the log shows
  // only now, its failure sentence first.
  const noAuto = { stats: fs.existsSync(path.join(dir, "stats.json")), analysis: fs.existsSync(path.join(dir, "analysis.json")),
    status: await p.$eval("#session-pills", (el) => (el.textContent || "").trim()).catch(() => "?"),
    logShown: await p.$eval("#log-host", (el) => getComputedStyle(el).display !== "none").catch(() => null) };
  // (The refused marker insert above stays on screen, so the status line may
  // offer to apply it; no analysis may be running.)
  record("AD-22: no analysis starts by itself on a recording whose annotations.json cannot be read (no update in the status line, no log, nothing written)",
    !noAuto.stats && !noAuto.analysis && !/Updating/.test(noAuto.status) && noAuto.logShown === false, JSON.stringify(noAuto));
  let analyzeMsg = "", failureFirst = "";
  try {
    await p.locator("#btn-help").click({ timeout: T });
    await p.locator('.help-nav-item[data-section="trouble"]').click({ timeout: T });
    await p.locator("#btn-help-reanalyze").click({ timeout: T });
    await p.waitForFunction(() => {
      const h = document.getElementById("log-host");
      return !!h && getComputedStyle(h).display !== "none" && /Analysis stopped, nothing was changed/.test(h.textContent || "");
    }, null, { timeout: 60000 });
    analyzeMsg = await p.$eval("#log-host", (el) => el.textContent || "");
    failureFirst = await p.$eval("#log-host > summary", (el) => (el.textContent || "").trim());
  } catch (e) { logActionError("RP-04 re-analyze", e); analyzeMsg = "no refusal shown: " + String(e.message).split("\n")[0]; }
  const afterAnalyze = untouched();
  record("RP-04: Re-analyze (Help, Troubleshooting) on that session is refused with the reason, the log shows with the failure sentence first; annotations.json is untouched",
    /Analysis stopped, nothing was changed: .*annotations\.json in this project folder cannot be read/.test(analyzeMsg) &&
      /^Analysis stopped, nothing was changed: /.test(failureFirst) && afterAnalyze,
    "first=" + JSON.stringify(failureFirst.slice(0, 120)) + " filesUntouched=" + afterAnalyze);

  // Lane CC: the banner's Restore the newest backup. It asks first, naming
  // the backup and its time; then the unreadable file is kept beside it as
  // annotations.unreadable-<time>.json, the backup is put in its place and
  // the project opens again, readable.
  const restore = {};
  try {
    await p.keyboard.press("Escape").catch(() => {});
    restore.button = ((await p.locator("#annotations-error-banner #btn-restore-annotations").textContent({ timeout: T })) || "").trim();
    await p.locator("#annotations-error-banner #btn-restore-annotations").click({ timeout: T });
    await p.waitForSelector(".modal-confirm", { state: "visible", timeout: T });
    restore.confirm = ((await p.locator(".modal-confirm").textContent({ timeout: T })) || "").replace(/\s+/g, " ").trim();
    await p.locator(".modal-confirm .modal-ok").click({ timeout: T });
    await p.waitForFunction(() => {
      const b = document.getElementById("annotations-error-banner");
      const s = require("./state.js").getSession();
      return !!(b && getComputedStyle(b).display === "none" && s && s.annotations && !s.annotationsError);
    }, null, { timeout: T });
    const kept = fs.readdirSync(dir).filter((n) => /^annotations\.unreadable-\d{8}-\d{6}\.json$/.test(n));
    restore.kept = kept;
    restore.keptIsTheBrokenFile = kept.length === 1 && fs.readFileSync(path.join(dir, kept[0]), "utf-8") === truncated;
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, "annotations.json"), "utf-8")); } catch (_) { /* reported below */ }
    restore.readable = !!(parsed && Array.isArray(parsed.steps));
    restore.toast = ((await p.$eval("#toast", (el) => el.textContent || "").catch(() => "")) || "").trim();
    // Lane FX3: the file attached after the backup is listed again on the
    // project (never deleted unseen), and the toast says so.
    restore.relisted = ((parsed && parsed.attachments) || []).filter((a) => a && a.file === "sop.txt")
      .map((a) => ({ label: a.label, step: a.step_id }));
    restore.fileKept = fs.existsSync(path.join(dir, "attachments", "sop.txt"));
    // The project opened with its annotations analyzes by itself (it has no
    // analysis yet): let that end before the window closes.
    await p.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 }).catch(() => {});
    await p.locator('.view-mode-btn[data-level="overview"]').click({ timeout: T }).catch(() => {});
    await p.waitForSelector("#ov-attach", { timeout: T }).catch(() => {});
    restore.onOverview = await p.evaluate(() => [...document.querySelectorAll("#ov-attach .att-row")]
      .map((r) => ((r.querySelector(".att-label-input") || {}).value || r.textContent || "").trim()));
  } catch (e) { logActionError("CC restore the newest backup", e); restore.err = String(e.message).split("\n")[0]; }
  record("lane CC: Restore the newest backup (the banner's act) asks first naming the backup and its time, keeps the unreadable file as annotations.unreadable-<time>.json and opens the project again with the backup",
    !!(!restore.err && restore.button === "Restore the newest backup" &&
      /Restore the newest backup\?/.test(restore.confirm || "") && /Put back the backup saved .+ \(annotations\.json\.2\)/.test(restore.confirm || "") &&
      restore.keptIsTheBrokenFile && restore.readable && /^Restored the backup saved /.test(restore.toast || "")),
    JSON.stringify(restore));
  record("lane FX3: a file attached after the restored backup is listed again with the document's attachments (its file kept), and the toast names it",
    !!(!restore.err && JSON.stringify(restore.relisted) === '[{"label":"sop.txt","step":null}]' && restore.fileKept &&
      /A file attached after that backup is listed again with the document's attachments on the Overview: sop\.txt\./.test(restore.toast || "") &&
      (restore.onOverview || []).some((t) => /sop\.txt/.test(t))),
    JSON.stringify({ relisted: restore.relisted, fileKept: restore.fileKept, toast: restore.toast, onOverview: restore.onOverview }));
  if (restore.err || !restore.readable) await shot(p, "fail-cc-restore-backup.png");

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
      summaryHome.outsideOverview === 0 && /\b4 transactions\b/.test(summaryHome.text || "")),
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

  // P1.2, lane LANES: the Transaction select is gone from every level (a
  // double-click on a transaction's band shows only it, Show all comes back);
  // "Scope to playhead" is gone too. Checked on each level in turn.
  const runSelect = {};
  for (const lvl of ["overview", "flow", "steps", "map"]) {
    await page.click('.view-mode-btn[data-level="' + lvl + '"]').catch(() => {});
    await wait(400);
    runSelect[lvl] = await page.evaluate(() => !!document.getElementById("case-scope") || !!document.getElementById("case-scope-select"))
      .catch(() => null);
  }
  await page.click('.view-mode-btn[data-level="flow"]').catch(() => {});
  await wait(400);
  const runSelectText = await page.evaluate(() => ({
    // AD-29: each transaction's band reads the way Steps names it, then its
    // marker label (the demo's "Order #..."), and says what a double-click does.
    bands: [...document.querySelectorAll("#timeline .tl-case-band")].map((b) => b.title.split("\n")),
    playhead: document.querySelectorAll("#btn-scope-to-playhead").length,
  })).catch((e) => ({ err: e.message }));
  const bandsT = runSelectText.bands || [];
  record("P1.2 + AD-29, lane LANES: no Transaction select on any level; each transaction's band on the Timeline is named Transaction N · its label and says Double-click: show only this transaction.; Scope to playhead is gone",
    runSelect.flow === false && runSelect.overview === false && runSelect.steps === false && runSelect.map === false &&
      bandsT.length === 4 && bandsT.every((t, i) => new RegExp("^Transaction " + (i + 1) + "( · \\S.*)?$").test(t[0])) &&
      bandsT.some((t) => / · Order #\d+$/.test(t[0])) && bandsT.every((t) => t[t.length - 1] === "Double-click: show only this transaction.") &&
      runSelectText.playhead === 0,
    JSON.stringify({ runSelect, runSelectText }));

  // P1.2 / P3.1 / P3.2 / P2.2: the chrome says each thing once. No VIEW label,
  // per-level hint, hidden level descriptions or top-bar date; the version is
  // in Help. AD-29: New and Open are two menus, New with its two projects,
  // Open with the folder picker and the recent projects.
  // V1 (step-back review 4.2): ONE bar holds New, Open, the four levels, the
  // status line, Export, Help and the theme, in that order; the actions bar,
  // the level bar under it, "Analyze session" and "More" are gone, and the
  // Overview's one orange button is its next act.
  await page.click('.view-mode-btn[data-level="overview"]').catch(() => {});
  await wait(400);
  const chrome = await page.evaluate(() => {
    const n = (sel) => document.querySelectorAll(sel).length;
    const shown = (el) => !!(el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0);
    const bar = document.querySelector("header.topbar");
    const inBar = (sel) => [...document.querySelectorAll(sel)].every((el) => bar && bar.contains(el));
    const order = ["#btn-new-menu", "#btn-recent-menu", '.view-mode-btn[data-level="overview"]', '.view-mode-btn[data-level="flow"]',
      '.view-mode-btn[data-level="steps"]', '.view-mode-btn[data-level="map"]', "#session-pills",
      "#btn-session-export-menu", "#btn-help", "#btn-theme-toggle"]
      .map((sel) => { const el = document.querySelector(sel); return el && bar && bar.contains(el) ? el.getBoundingClientRect().left : null; });
    const levelBtns = [...document.querySelectorAll(".view-mode-btn")];
    return {
      gone: n(".view-mode-label") + n("#view-mode-help") + n(".view-mode-desc") + n("#topbar-meta") + n("#onboarding-card"),
      version: ((document.getElementById("help-version") || {}).textContent || "").trim(),
      newMenu: ((document.querySelector("#btn-new-menu span") || {}).textContent || "").trim(),
      newItems: [...document.querySelectorAll("#new-menu-popup .project-menu-item")].map((b) => (b.textContent || "").trim()),
      newItemIds: [...document.querySelectorAll("#new-menu-popup .project-menu-item")].map((b) => b.id),
      openMenu: ((document.querySelector("#btn-recent-menu span") || {}).textContent || "").trim(),
      openItems: [...document.querySelectorAll("#recent-menu-popup > .project-menu-item")].map((b) => (b.textContent || "").trim()),
      openFolderInMenu: !!document.querySelector("#recent-menu-popup #btn-open-session"),
      openFolderLabel: ((document.getElementById("btn-open-session") || {}).textContent || "").trim(),
      analyzeButton: n("#btn-normalize") + [...document.querySelectorAll("button")].filter((b) => /Analyze session/.test(b.textContent || "")).length,
      moreMenu: n("#session-more-menu, #btn-session-more-menu, #session-more-popup") +
        [...document.querySelectorAll("button")].filter((b) => /More\b/.test(b.textContent || "") && /\u22ef/.test(b.textContent || "")).length,
      actionsBar: n(".actions-bar"),
      bars: [...document.querySelectorAll(".view-mode-bar")].map((el) => !!(bar && bar.contains(el))),
      allInBar: inBar(".view-mode-btn") && inBar("#session-pills") && inBar("#btn-session-export-menu") &&
        inBar("#btn-new-menu") && inBar("#btn-recent-menu") && inBar("#btn-help") && inBar("#btn-theme-toggle"),
      inOrder: order.every((x) => x != null) && order.every((x, i) => i === 0 || x >= order[i - 1]),
      levels: levelBtns.map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()),
      titles: levelBtns.map((b) => b.title),
      barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
      orangeOnOverview: [...document.querySelectorAll("#session-loaded button.primary, header.topbar button.primary")].filter(shown)
        .map((b) => (b.textContent || "").trim()),
    };
  }).catch((e) => ({ err: e.message }));
  record("V1 + AD-29: one top bar holds New, Open, the four levels (Overview, Timeline, Steps, Map), the status line, Export, Help and the theme; New and Open are separate menus; no actions bar, no Analyze session, no More menu; one orange button on the Overview; the version is in Help",
    !!(chrome && !chrome.err && chrome.gone === 0 && /^Version \d+\.\d+\.\d+/.test(chrome.version) &&
      chrome.newMenu === "New" && JSON.stringify(chrome.newItems) === JSON.stringify(["New project from a video...", "New empty project..."]) &&
      JSON.stringify(chrome.newItemIds) === JSON.stringify(["btn-new-from-video", "btn-new-blank"]) &&
      // Lane HV: a hand-off zip has its own item (the folder dialog lists folders only).
      // Lane MW: another project in a new window (e2e/windows-smoke.js).
      chrome.openMenu === "Open" && JSON.stringify(chrome.openItems) === JSON.stringify(["Open project...", "Open in a new window...", "Open a zip...", "Open the demo project"]) &&
      chrome.openFolderInMenu && chrome.openFolderLabel === "Open project..." &&
      chrome.analyzeButton === 0 && chrome.moreMenu === 0 && chrome.actionsBar === 0 &&
      JSON.stringify(chrome.bars) === "[true]" && chrome.allInBar && chrome.inOrder &&
      JSON.stringify(chrome.levels) === JSON.stringify(["◈ Overview", "≡ Timeline", "▣ Steps", "◯ Map"]) &&
      JSON.stringify(chrome.titles) === JSON.stringify(["The checklist, the project and the document",
        "The recording: video, screenshots, transactions and what was said",
        "Each transaction's steps: confirm transaction 1, then review the others",
        "The process map, and your As-Is and To-Be maps"]) &&
      chrome.barHeight > 0 && chrome.barHeight < 60 &&
      chrome.orangeOnOverview.length === 1 && chrome.orangeOnOverview[0] === "Confirm transaction 1 in Steps"),
    JSON.stringify(chrome));

  // AD-29: New and Open are two menus side by side; opening one closes the
  // other (control interaction), and a click outside closes both.
  const menus = {};
  try {
    const shownPopups = () => page.evaluate(() => ["new-menu-popup", "recent-menu-popup", "session-export-popup"]
      .filter((id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== "none"; }));
    await page.locator("#btn-new-menu").click({ timeout: 15000 });
    menus.afterNew = await shownPopups();
    await page.locator("#btn-recent-menu").click({ timeout: 15000 });
    menus.afterOpen = await shownPopups();
    await page.locator("#btn-session-export-menu").click({ timeout: 15000 });
    menus.afterExport = await shownPopups();
    await page.mouse.click(5, 400);
    menus.afterOutside = await shownPopups();
  } catch (e) { logActionError("AD-29 New and Open menus", e); menus.err = String(e.message).split("\n")[0]; }
  record("AD-29: New, Open and Export each open alone (opening one closes the other), and a click outside closes them",
    !menus.err && JSON.stringify(menus.afterNew) === '["new-menu-popup"]' && JSON.stringify(menus.afterOpen) === '["recent-menu-popup"]' &&
      JSON.stringify(menus.afterExport) === '["session-export-popup"]' && JSON.stringify(menus.afterOutside) === "[]",
    JSON.stringify(menus));

  // Lane FX3 (validation pass 3, F21): Escape closes New, Open and Export,
  // and the keyboard goes back to the menu's button.
  const escMenus = {};
  try {
    const shownPopups = () => page.evaluate(() => ["new-menu-popup", "recent-menu-popup", "session-export-popup"]
      .filter((id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== "none"; }));
    for (const [btn, popup] of [["btn-new-menu", "new-menu-popup"], ["btn-recent-menu", "recent-menu-popup"], ["btn-session-export-menu", "session-export-popup"]]) {
      await page.locator("#" + btn).click({ timeout: 15000 });
      const open = await shownPopups();
      await page.keyboard.press("Escape");
      await wait(150);
      escMenus[btn] = { open: JSON.stringify(open) === JSON.stringify([popup]), after: await shownPopups(),
        focus: await page.evaluate(() => (document.activeElement || {}).id || "") };
    }
  } catch (e) { logActionError("FX3 Escape closes the menus", e); escMenus.err = String(e.message).split("\n")[0]; }
  record("lane FX3: Escape closes the New, Open and Export menus, the keyboard back on the menu's button",
    !escMenus.err && ["btn-new-menu", "btn-recent-menu", "btn-session-export-menu"].every((b) =>
      escMenus[b] && escMenus[b].open && escMenus[b].after.length === 0 && escMenus[b].focus === b),
    JSON.stringify(escMenus));

  // Lane HT: Help opens on Getting started, the process managers' guide, and
  // it is docs/HOW-TO.md in the same words: the same sections in the same
  // order, the same everyday tasks, the first hour's ten acts and the
  // glossary's words; every sentence on the page is found word for word in
  // the document (the page may leave a sentence out, never say it in other
  // words). No dash punctuation, and nothing wider than the Help's body.
  const helpStart = {};
  try {
    helpStart.doc = howToDoc();
    await page.locator("#btn-help").click({ timeout: 15000 });
    helpStart.state = await page.evaluate(() => {
      const sec = document.querySelector('.help-section[data-section="start"]');
      const body = document.querySelector(".help-body");
      const nav = document.querySelector(".help-nav-item.active");
      const txt = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();
      const heads = [], tasks = [], acts = [], terms = [];
      let h = null;
      for (const el of sec ? [...sec.children] : []) {
        if (el.tagName === "H3") { h = txt(el); heads.push(h); continue; }
        if (h === "Everyday tasks" && el.tagName === "P" && el.children.length === 1 &&
          el.firstElementChild.tagName === "STRONG" && txt(el) === txt(el.firstElementChild)) tasks.push(txt(el));
        if (h === "Your first hour" && el.tagName === "OL") {
          for (const li of el.children) acts.push(txt(li.querySelector(":scope > strong")));
        }
        if (h === "Glossary" && el.tagName === "TABLE") for (const tr of el.querySelectorAll("tr")) terms.push(txt(tr.cells[0]));
      }
      return {
        active: nav ? nav.dataset.section : null,
        first: (document.querySelector(".help-nav-item") || { dataset: {} }).dataset.section,
        firstLabel: txt(document.querySelector(".help-nav-item")),
        shown: !!sec && sec.classList.contains("active") && sec.getClientRects().length > 0,
        heads, tasks, acts, terms,
        blocks: sec ? [...sec.querySelectorAll("h3, p, li, dt, dd, td")].map(txt) : [],
        text: txt(sec),
        wide: body ? body.scrollWidth - body.clientWidth : null,
      };
    });
    await page.keyboard.press("Escape");
  } catch (e) { logActionError("HT Help Getting started", e); helpStart.err = String(e.message).split("\n")[0]; }
  const hs = helpStart.state || {}, hd = helpStart.doc || {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Each block's sentences: a sentence ends at . ! or ? before a capital, a
  // quote or a bracket.
  const unmatched = (hs.blocks || []).flatMap((b) => b.split(/(?<=[.!?])\s+(?=[A-Z"(])/))
    .filter((s) => s && !(hd.plain || "").includes(s));
  record("lane HT: Help opens on Getting started, the guide of docs/HOW-TO.md in its words: the same sections, everyday tasks, " +
    "first-hour acts (ten) and glossary words, every sentence of the page found in the document, no dash punctuation, nothing wider than the Help",
    !helpStart.err && hs.active === "start" && hs.first === "start" && hs.firstLabel === "Getting started" && hs.shown &&
      hd.heads.length === 9 && same(hs.heads, hd.heads) &&
      hd.tasks.length === 12 && same(hs.tasks, hd.tasks) &&
      hd.acts.length === 10 && same(hs.acts, hd.acts) &&
      hd.terms.length >= 10 && same(hs.terms, hd.terms) &&
      (hs.blocks || []).length > 60 && unmatched.length === 0 &&
      !/[\u2013\u2014]| - |--/.test(hs.text || "") && hs.wide === 0,
    JSON.stringify({ err: helpStart.err, active: hs.active, heads: hs.heads, tasks: hs.tasks, acts: (hs.acts || []).length,
      terms: (hs.terms || []).length, blocks: (hs.blocks || []).length, unmatched: unmatched.slice(0, 3), wide: hs.wide }));

  // Lane FX3 (validation pass 3, F13): Help has a Map section: the two views,
  // the picker, the As-Is and To-Be maps, Edited maps and the two map exports.
  const helpMap = {};
  try {
    await page.locator("#btn-help").click({ timeout: 15000 });
    await page.locator('.help-nav-item[data-section="map"]').click({ timeout: 15000 });
    helpMap.state = await page.evaluate(() => {
      const sec = document.querySelector('.help-section[data-section="map"]');
      return { nav: [...document.querySelectorAll(".help-nav-item")].map((b) => b.dataset.section),
        shown: !!sec && sec.classList.contains("active") && sec.getClientRects().length > 0,
        heads: sec ? [...sec.querySelectorAll("h3")].map((h) => h.textContent.trim()) : [],
        text: sec ? sec.textContent.replace(/\s+/g, " ") : "" };
    });
    await page.keyboard.press("Escape");
  } catch (e) { logActionError("FX3 Help Map", e); helpMap.err = String(e.message).split("\n")[0]; }
  const hm = helpMap.state || {};
  record("lane FX3: Help has a Map section after Steps: what the Map shows and how the transactions ran, the picker for sub-processes, Edit as the As-Is map and the To-Be map, Edited maps, and the image and BPMN exports",
    !helpMap.err && JSON.stringify(hm.nav) === JSON.stringify(["start", "stepsphases", "map", "markers", "capture", "handoff", "shortcuts", "trouble"]) &&
      hm.shown && JSON.stringify(hm.heads) === JSON.stringify(["What the Map shows", "Sub-processes", "Your As-Is and To-Be maps", "Exporting the map"]) &&
      ["Show how the transactions ran", "Map:", "Edit as the As-Is map", "Edit a new copy", "To-Be map", "Edited maps", "Copy again",
        "Process map (image)", "Process map (BPMN)"].every((w) => (hm.text || "").includes(w)),
    JSON.stringify({ err: helpMap.err, nav: hm.nav, shown: hm.shown, heads: hm.heads }));

  // Lane A-1: a dialog keeps the keyboard. Help takes the focus and gives it
  // back to its button; the + Add step prompt is a labelled modal dialog,
  // Tab pressed six times never leaves it, and Escape gives the focus back to
  // + Add step.
  const dlg = {};
  try {
    const inside = (sel) => page.evaluate((s) => {
      const d = document.querySelector(s);
      const a = document.activeElement;
      return !!(d && a && a !== document.body && d.contains(a)) ? "in" : "OUT:" + (a ? a.tagName + "#" + (a.id || "") : "none");
    }, sel);
    await page.locator("#btn-help").click({ timeout: 15000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("help-modal")).display !== "none", null, { timeout: 15000 });
    dlg.help = await page.evaluate(() => {
      const m = document.querySelector("#help-modal .modal");
      return { role: m.getAttribute("role"), modal: m.getAttribute("aria-modal"), label: (document.getElementById(m.getAttribute("aria-labelledby")) || {}).textContent || "" };
    });
    dlg.helpTrail = [await inside("#help-modal .modal")];
    // From its first item (the close cross) Shift+Tab goes round to its last,
    // and Tab from there comes back to the first.
    await page.locator("#btn-help-close").focus();
    for (const key of ["Shift+Tab", "Tab", "Tab"]) { await page.keyboard.press(key); dlg.helpTrail.push(await inside("#help-modal .modal")); }
    await page.keyboard.press("Escape");
    await wait(150);
    dlg.helpBack = await page.evaluate(() => (document.activeElement || {}).id || "");
    const level = await page.evaluate(() => (document.querySelector(".view-mode-btn.active") || { dataset: {} }).dataset.level);
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: 15000 });
    await page.locator("#btn-add-manual-step").click({ timeout: 15000 });
    await page.waitForSelector(".modal-backdrop.modal-prompt .modal-input", { timeout: 15000 });
    await wait(100);
    dlg.prompt = await page.evaluate(() => {
      const m = document.querySelector(".modal-backdrop.modal-prompt .modal");
      const t = document.getElementById(m.getAttribute("aria-labelledby") || "");
      return { role: m.getAttribute("role"), modal: m.getAttribute("aria-modal"), label: t ? t.textContent : "",
        first: (document.activeElement || {}).className || "" };
    });
    dlg.trail = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); dlg.trail.push(await inside(".modal-backdrop.modal-prompt .modal")); }
    await page.locator(".modal-backdrop.modal-prompt .modal-input").focus();
    await page.keyboard.press("Escape");
    await page.waitForSelector(".modal-prompt", { state: "detached", timeout: 15000 });
    dlg.back = await page.evaluate(() => (document.activeElement || {}).id || "");
    if (level) await page.locator('.view-mode-btn[data-level="' + level + '"]').click({ timeout: 15000 });
  } catch (e) { logActionError("A-1 dialogs keep the keyboard", e); dlg.err = String(e.message).split("\n")[0]; }
  record("lane A-1: Help and the + Add step prompt are modal dialogs named by their title; each takes the focus, Tab and Shift+Tab stay inside, and closing gives the focus back to the button that opened it",
    !dlg.err && dlg.help && dlg.help.role === "dialog" && dlg.help.modal === "true" && dlg.help.label === "How to use" &&
      dlg.helpTrail.every((x) => x === "in") && dlg.helpBack === "btn-help" &&
      dlg.prompt && dlg.prompt.role === "dialog" && dlg.prompt.modal === "true" && !!dlg.prompt.label && /modal-input/.test(dlg.prompt.first) &&
      dlg.trail.length === 6 && dlg.trail.every((x) => x === "in") && dlg.back === "btn-add-manual-step",
    JSON.stringify(dlg));

  // Lane FX3 (validation pass 3, F20): why the capture app ended a
  // transaction by itself, in plain words, never its code. Lane PANE: the
  // Markers tab is gone; the transaction's header in the pane's Steps tab
  // says it. The demo's markers carry no reason, so three are given one on
  // the page (the recording's file is not touched) and the pane is drawn
  // again; the headers are read in the transactions' order.
  const reasons = {};
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: 15000 });
    await page.locator('#tp-tab-steps').click({ timeout: 15000 });
    reasons.rows = await page.evaluate(() => {
      const ends = require("./state.js").getSession().events.filter((e) => e.type === "marker" && e.data && e.data.marker_type === "end");
      const was = ends.slice(0, 3).map((e) => e.data.reason);
      ends[0].data.reason = "auto_close_for_sibling";
      ends[1].data.reason = "auto_end_idle";
      ends[2].data.reason = "some_future_code";
      const Pane = require("./views/timeline-pane.js");
      Pane.render();
      const s = require("./state.js").getSession();
      const runs = require("./runs-model.js").buildRuns(s.stats, s.annotations.steps).runs;
      const heads = [...document.querySelectorAll("#tp-steps .tp-tx-head[data-case-id]")];
      const rows = runs.slice(0, 3).map((r) => { const h = heads.find((x) => x.dataset.caseId === r.caseId);
        return h ? ((h.querySelector(".tp-tx-why") || {}).textContent || "") : null; });
      ends.slice(0, 3).forEach((e, i) => { if (was[i] === undefined) delete e.data.reason; else e.data.reason = was[i]; });
      Pane.render();
      return rows;
    });
    await page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: 15000 });
    await page.mouse.move(2, 600);
    await wait(500);   // the level buttons' colour transition ends before the next check reads them
  } catch (e) { logActionError("FX3 marker reasons", e); reasons.err = String(e.message).split("\n")[0]; }
  record("lane FX3, lane PANE: a transaction's header in the pane's Steps tab says why it ended by itself in plain words (the next transaction started, after a long idle stretch), never a raw code",
    !reasons.err && JSON.stringify(reasons.rows) === JSON.stringify(["Ended by itself: the next transaction started.", "Ended by itself: after a long idle stretch.", ""]),
    JSON.stringify(reasons));

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
  // notch): one band per visible step, named as the step is named. Lane FX2
  // (validation pass 2, F8): a one-click step (it starts and ends in the same
  // moment) has its band too.
  const laneBands = await page.evaluate(() => {
    const steps = ((require("./state.js").getSession().annotations || {}).steps || [])
      .filter((st) => st && st.state !== "hidden" && st.time_range && st.time_range.start && st.time_range.end &&
        Date.parse(st.time_range.end) >= Date.parse(st.time_range.start));
    const bands = [...document.querySelectorAll(".tl-step-band[data-step-id]")];
    const byId = Object.fromEntries(steps.map((st) => [st.step_id, st]));
    const oneClick = steps.filter((st) => Date.parse(st.time_range.end) === Date.parse(st.time_range.start));
    return {
      steps: steps.length, bands: bands.length,
      // Lane LANES: the name is the band's .tl-step-name (shown where it reads,
      // the step's number in its place on a narrow band) and its tooltip's start.
      named: bands.every((b) => byId[b.dataset.stepId] && ((b.querySelector(".tl-step-name") || {}).textContent || "") === byId[b.dataset.stepId].name &&
        (b.title || "").startsWith(byId[b.dataset.stepId].name + " · ")),
      folded: bands.filter((b) => / steps\)/.test(b.title || "")).length,
      oneClick: oneClick.length,
      oneClickDrawn: oneClick.filter((st) => { const b = bands.find((x) => x.dataset.stepId === st.step_id); return !!b && b.getBoundingClientRect().width > 0; }).length,
    };
  }).catch((e) => ({ err: e.message }));
  record("item 1 + lane FX2: the Flow steps lane shows one band per step, named as the step (no roll-up), one-click steps included",
    !!(laneBands && !laneBands.err && laneBands.steps > 0 && laneBands.bands === laneBands.steps &&
      laneBands.named && laneBands.folded === 0 && laneBands.oneClick > 0 && laneBands.oneClickDrawn === laneBands.oneClick), JSON.stringify(laneBands));
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

  // The Overview holds the Checklist, the project line and the document: no
  // dot strip, business-required editor or candidate cards, and (2.0.1) no
  // Observations, the PDD's rows being the document's alone.
  const STATE_TIMEOUT = 15000;
  await page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: STATE_TIMEOUT }).catch(() => {});
  await page.waitForSelector("#ov-doc", { timeout: STATE_TIMEOUT }).catch(() => {});
  const ovGone = await page.evaluate(() => ({
    format: (require("./state.js").getSession().analysis || {}).format,
    gone: document.querySelectorAll("#overview-content .ts-dot, #overview-content .ts-strip, #overview-content .waste-row, " +
      "#overview-content .auto-cards, #overview-content .ov-finding, #overview-evidence, #overview-content table.ov-time, " +
      "#ov-observations, #overview-content table.ov-rows").length,
    doc: !!document.getElementById("ov-doc"),
  })).catch((e) => ({ err: e.message }));
  const ovOk = !!(ovGone && !ovGone.err && ovGone.format === 5 && ovGone.gone === 0 && ovGone.doc);
  record("2.0.1: the Overview holds the document and no Observations (analysis.json format 5); no dot strip, total, editor or candidate cards",
    ovOk, JSON.stringify(ovGone));
  if (!ovOk) await shot(page, "fail-overview-no-observations.png");

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
  record("(disclosure 1) no-recording video stage collapses to a slim band (the side panel gets the space; its verb is Attach video...)",
    videoBandOk, JSON.stringify(videoBand));
  if (!videoBandOk) await shot(page, "fail-video-collapse.png");

  // --- P1.6 + AD-17 / F4 / P1.1: Flow's side panel --------------------------
  // The Notes tab and its note field are gone (AD-17); notes pinned to a
  // moment came back as a lane (AD-27, C16), listed only while such a note
  // exists (none here). Screenshots is the panel's first and default tab,
  // next to Markers. The
  // thumbnails show local time, the timeline's and the markers' clock (F4).
  // The shortcuts overlay is gone from every level (Help keeps the list).
  const sidePanel = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("#session-layout-flow .anno-tab")].map((t) => ({
      anno: t.dataset.anno, active: t.classList.contains("active") }));
    const screens = document.querySelector('.anno-panel[data-panel="steps"]');
    // One clock (V2 item 6): the time since the recording started, m:ss.
    const origin = Date.parse(require("./state.js").getSession().manifest.started_at);
    const local = (iso) => { const t = Math.floor((Date.parse(iso) - origin) / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
    const shots = (require("./state.js").getSession().events || []).filter((e) => e.type === "system" &&
      (e.data.kind === "screenshot" || e.data.kind === "screenshot_manual"));
    const stamps = [...document.querySelectorAll("#screenshots-grid .thumb .stamp")].map((s) => s.textContent);
    return {
      tabs,
      screensShown: !!(screens && getComputedStyle(screens).display !== "none"),
      notesGone: document.querySelectorAll('#anno-note, #btn-save-note, #annotations-list, #markers-list, .anno-tab[data-anno="markers"]').length === 0 &&
        !!document.getElementById("lane-notes-row") && document.getElementById("lane-notes-row").hidden,
      overlayGone: !document.getElementById("shortcuts-overlay") && !document.querySelector(".kbd-hint"),
      stamps, localStamps: shots.map((e) => local(e.timestamp)),
      utcStamps: shots.map((e) => String(e.timestamp).slice(11, 19)),
      offsetMin: new Date(shots.length ? shots[0].timestamp : Date.now()).getTimezoneOffset(),
    };
  }).catch((e) => ({ err: e.message }));
  const panelOk = !!(sidePanel && !sidePanel.err &&
    // Lane PANE: five tabs, the project opening on Steps; the Markers tab is gone.
    JSON.stringify(sidePanel.tabs) === JSON.stringify([{ anno: "steps", active: true }, { anno: "transcript", active: false },
      { anno: "screens", active: false }, { anno: "notes", active: false }, { anno: "files", active: false }]) &&
    sidePanel.screensShown && sidePanel.notesGone && sidePanel.overlayGone);
  record("P1.6 (AD-17, AD-27) + P1.1, lane PANE: the pane beside the video opens on Steps, then Transcript, Screenshots, Notes and Files (no Markers tab, no note field), and no Notes lane without a note pinned to a moment; no shortcuts overlay",
    panelOk, JSON.stringify(sidePanel && { tabs: sidePanel.tabs, screensShown: sidePanel.screensShown,
      notesGone: sidePanel.notesGone, overlayGone: sidePanel.overlayGone, err: sidePanel.err }));
  const stampsOk = !!(sidePanel && !sidePanel.err && sidePanel.stamps.length > 0 &&
    JSON.stringify(sidePanel.stamps) === JSON.stringify(sidePanel.localStamps) &&
    sidePanel.stamps.every((s, i) => s !== sidePanel.utcStamps[i]));
  record("F4 + V2 item 6: the screenshot thumbnails show the one clock, the time since the recording started (m:ss), never a time of day",
    stampsOk, JSON.stringify(sidePanel && { stamps: sidePanel.stamps, sinceStart: sidePanel.localStamps, timeOfDay: sidePanel.utcStamps }));
  if (!(panelOk && stampsOk)) await shot(page, "fail-flow-side-panel.png");

  // Lane PANE, item 1: the pane's tabs are tabs to a screen reader (a
  // tablist, each tab naming its panel, the panel named by its tab, the
  // chosen one aria-selected and the only Tab stop), the arrow keys, Home and
  // End move between them, they stay on one line at the window's width (the
  // counts may drop first where they cannot fit), and Steps counts the steps
  // its list shows, Screenshots the screenshots of its grid.
  const tabsA11y = {};
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: 15000 });
    await page.locator("#tp-tab-steps").click({ timeout: 15000 });
    if (await page.locator("#tp-steps .tp-back").count()) await page.locator("#tp-steps .tp-back").click({ timeout: 15000 });
    const read = () => page.evaluate(() => {
      const list = document.getElementById("tp-tabs");
      const tabs = [...list.querySelectorAll(".anno-tab")];
      return {
        role: list.getAttribute("role"),
        tabs: tabs.map((t) => { const p = document.getElementById(t.getAttribute("aria-controls"));
          return { anno: t.dataset.anno, role: t.getAttribute("role"), sel: t.getAttribute("aria-selected"), tab: t.tabIndex,
            panel: !!p && p.getAttribute("role") === "tabpanel" && p.getAttribute("aria-labelledby") === t.id,
            shown: !!p && getComputedStyle(p).display !== "none", label: t.getAttribute("aria-label") }; }),
        oneLine: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size === 1 && list.scrollWidth <= list.clientWidth + 1,
        short: list.classList.contains("short"),
        focus: (document.activeElement || {}).id || "",
        rows: document.querySelectorAll("#tp-steps .tp-row").length,
        shots: require("./views/flow-view-screenshots.js").timelineScreenshots().length,
      };
    });
    tabsA11y.start = await read();
    await page.locator("#tp-tab-steps").focus();
    await page.keyboard.press("ArrowRight");
    tabsA11y.right = await read();
    await page.keyboard.press("End");
    tabsA11y.end = await read();
    await page.keyboard.press("Home");
    tabsA11y.home = await read();
  } catch (e) { logActionError("PANE tabs", e); tabsA11y.err = String(e.message).split("\n")[0]; }
  const tabOk = (st, want) => !!st && st.role === "tablist" && st.tabs.length === 5 &&
    st.tabs.every((t) => t.role === "tab" && t.panel && (t.anno === want) === (t.sel === "true") && (t.anno === want) === (t.tab === 0) && (t.anno === want) === t.shown) &&
    st.oneLine;
  const s0 = tabsA11y.start || { tabs: [] };
  record("lane PANE item 1: the pane's five tabs are a tablist (each tab names its panel, each panel is named by its tab, only the chosen tab is a Tab stop); Right, End and Home move the choice and the focus; one line at this width; Steps counts its rows, Screenshots its grid",
    !tabsA11y.err && tabOk(tabsA11y.start, "steps") && tabOk(tabsA11y.right, "transcript") && tabsA11y.right.focus === "tp-tab-transcript" &&
      tabOk(tabsA11y.end, "files") && tabsA11y.end.focus === "tp-tab-files" && tabOk(tabsA11y.home, "steps") && tabsA11y.home.focus === "tp-tab-steps" &&
      s0.tabs[0].label === "Steps (" + s0.rows + ")" && s0.tabs[2].label === "Screenshots (" + s0.shots + ")" && s0.tabs[1].label === "Transcript",
    JSON.stringify(tabsA11y));
  // V2 item 6: the timeline's axis reads the same clock (0:00 at the start),
  // and the time of day shows only in the summary with the recording's date.
  const axis = await page.evaluate(() => ({
    ticks: [...document.querySelectorAll("#timeline .tl-flow-tick-label")].map((l) => (l.textContent || "").trim()),
    summary: ((document.getElementById("timeline-summary") || {}).textContent || "").trim(),
  })).catch((e) => ({ err: e.message }));
  record("V2 item 6: the timeline's tick labels read the time since the recording started (m:ss); the summary carries the date",
    !!(axis && !axis.err && axis.ticks.length >= 3 && axis.ticks.every((t) => /^\d+:\d{2}(:\d{2})?$/.test(t)) &&
      axis.ticks.includes("1:00") && /^Recorded .+ · \d/.test(axis.summary)),
    JSON.stringify(axis));

  // --- V1 (step-back review 4.2): "More" dissolved; each item is where it is
  // used, with the ids its wiring and the tests use: Attach video on the
  // video band (#btn-link-recording) and the Overview's recording line
  // (#btn-attach-video); Attach transcript on the recording line; Apps outside
  // the process in the Steps toolbar (Remembered step names left with contract
  // C21); Sync video in the video pane's
  // header, only while a video is attached; the timeline row's Add step with
  // a video only.
  const placed = () => page.evaluate(() => {
    const shown = (el) => !!(el && getComputedStyle(el).display !== "none" && !el.hidden);
    const at = (id) => { const el = document.getElementById(id); return el ? { text: (el.textContent || "").trim(), shown: shown(el) } : null; };
    const inside = (id, sel) => { const el = document.getElementById(id); return !!(el && el.closest(sel)); };
    return {
      more: document.querySelectorAll("#session-more-menu, #btn-session-more-menu, #session-more-popup").length,
      linkRecording: Object.assign(at("btn-link-recording") || {}, { inBand: inside("btn-link-recording", "#no-video") }),
      attachVideo: Object.assign(at("btn-attach-video") || {}, { inLine: inside("btn-attach-video", "#ov-summary") }),
      attachTranscript: Object.assign(at("btn-attach-transcript") || {}, { inLine: inside("btn-attach-transcript", "#ov-summary") }),
      ignoredApps: Object.assign(at("btn-ignored-apps") || {}, { inSteps: inside("btn-ignored-apps", "#session-layout-steps .editor-toolbar") }),
      savedNames: document.querySelectorAll("#btn-remembered-names, #remembered-names-dialog").length,
      syncVideo: Object.assign(at("btn-sync-video") || {}, { inHeader: inside("btn-sync-video", "#video-pane .video-controls") }),
      addStep: shown(document.getElementById("btn-add-step")),
    };
  });
  let noVideo = null;
  try { noVideo = await placed(); } catch (e) { logActionError("V1 moved controls", e); noVideo = { err: String(e.message).split("\n")[0] }; }
  const movedOk = !!(noVideo && !noVideo.err && noVideo.more === 0 &&
    noVideo.linkRecording.text === "Attach video..." && noVideo.linkRecording.inBand &&
    noVideo.attachVideo.text === "Attach" && noVideo.attachVideo.inLine &&
    noVideo.attachTranscript.text === "Attach" && noVideo.attachTranscript.inLine &&
    noVideo.ignoredApps.text === "Apps outside the process..." && noVideo.ignoredApps.inSteps &&
    noVideo.savedNames === 0 &&
    noVideo.syncVideo.inHeader && noVideo.syncVideo.shown === false && noVideo.addStep === false &&
    !(await page.$("#cb-mine")));
  record("V1: no More menu; its items are where they are used (Attach video on the video band and the recording line, Attach transcript on the recording line, Apps outside the process in the Steps toolbar and no Remembered step names (contract C21), Sync video in the video header, hidden without a video), and the Timeline has no Add step without a video",
    movedOk, JSON.stringify(noVideo));

  // --- P2.10: the Raw events drawer is Flow's only ---------------------------
  // The machine layer shows on Flow and nowhere else; opened there, it sits
  // below the Flow layout, nothing painted over. Lane SCREEN: the page does
  // not grow there: the table opens above the drawer's own line, which stays
  // put, and the timeline's row stays in view.
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
  const summaryTop = await page.evaluate(() => { const s = document.querySelector(".event-table-host > summary"); return s ? Math.round(s.getBoundingClientRect().top) : null; });
  if (summary) {
    await summary.scrollIntoViewIfNeeded().catch(() => {});
    await summary.click().catch((e) => console.log("rawevents open", e.message));
    await wait(900);
  }
  const flowGeom = await page.evaluate(() => {
    const d = document.querySelector(".event-table-host");
    const flow = document.getElementById("session-layout-flow");
    if (!d || !flow) return null;
    const row = document.getElementById("tl-row").getBoundingClientRect();
    const view = document.getElementById("view-session");
    return { open: d.open, flowBottom: Math.round(flow.getBoundingClientRect().bottom), rawTop: Math.round(d.getBoundingClientRect().top),
      summaryTop: Math.round(d.querySelector("summary").getBoundingClientRect().top), rowTop: Math.round(row.top), rowBottom: Math.round(row.bottom),
      tableTop: Math.round(d.querySelector(".event-table-scroll").getBoundingClientRect().top), pageScrolls: view.scrollHeight > view.clientHeight };
  }).catch((e) => ({ err: e.message }));
  const drawerOk = !!(drawerOn.flow && !drawerOn.overview && !drawerOn.steps && !drawerOn.map &&
    flowGeom && !flowGeom.err && flowGeom.open && flowGeom.flowBottom <= flowGeom.rawTop &&
    flowGeom.summaryTop === summaryTop && flowGeom.tableTop < flowGeom.summaryTop && flowGeom.rowTop >= 0 && flowGeom.rowBottom <= flowGeom.rawTop &&
    !flowGeom.pageScrolls);
  record("P2.10: the Raw events drawer shows on Flow only; opened there it sits below the Flow layout; lane SCREEN: its table opens above its own line, which stays put, the timeline's row stays in view and the page does not scroll",
    drawerOk, JSON.stringify({ shownOn: drawerOn, summaryTop, flowGeom }));
  // Lane FX1 (report 1, item 7): the one clock. Each row's time is the time
  // since the recording started (m:ss), never the time of day.
  const rawTimes = await page.evaluate(() => {
    const s = require("./state.js").getSession();
    const origin = Date.parse(s.manifest.started_at);
    const since = (iso) => { const t = Math.floor((Date.parse(iso) - origin) / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
    const rows = [...document.querySelectorAll("#event-table tbody tr")].slice(0, 40);
    const evs = (s.events || []).slice(0, rows.length);
    return { shown: rows.map((r) => (r.querySelector(".t-time") || {}).textContent || ""), want: evs.map((e) => since(e.timestamp)) };
  }).catch((e) => ({ err: String(e.message).split("\n")[0] }));
  record("lane FX1: the Raw events rows read the time since the recording started (m:ss), as every other time in the viewer",
    !!(rawTimes && !rawTimes.err && rawTimes.shown.length >= 5 && rawTimes.shown.every((t) => /^\d+:\d{2}$/.test(t)) &&
      JSON.stringify(rawTimes.shown) === JSON.stringify(rawTimes.want)),
    JSON.stringify(rawTimes && { shown: (rawTimes.shown || []).slice(0, 6), want: (rawTimes.want || []).slice(0, 6), err: rawTimes.err }));
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
  // the runs' edges. C17: the map also draws the process's Start and End
  // events, joined to every first and last step; they would join islands
  // too, so the pin reads the step boxes and the lines between them only.
  // Lane MV: the live map is the Map's second view, how the transactions ran.
  if (mapBtn) {
    await mapBtn.click().catch(() => {});
    await wait(1200);
    await showRuns(page).catch((e) => console.log("[e2e] the live map did not show:", String(e.message).split("\n")[0]));
  }
  const connProbe = await page.evaluate(() => {
    const host = document.getElementById("session-map-dfg-host");
    const cy = host && host.__cy;
    if (!cy) return { rendered: false, text: host ? (host.textContent || "").slice(0, 200) : null };
    const isStep = (n) => n.data("kind") !== "event";
    const nodes = cy.nodes().filter(isStep).map((n) => n.id());
    const edges = cy.edges().filter((e) => isStep(e.source()) && isStep(e.target()))
      .map((e) => ({ s: e.data("source"), t: e.data("target") }));
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
      // Every edge, those of the Start and End events included (C17).
      allDrawn: cy.edges().length,
      allEdges: (() => {
        const s = require("./state.js").getSession();
        const L = require("./process-map-levels.js");
        const runs = require("./runs-model.js").buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
        return L.flowEdges(L.buildAnnotationDfg(runs.map((r) => r.visible))).length;
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
      connProbe.edges === connProbe.runEdges && connProbe.allDrawn === connProbe.allEdges && connProbe.filterControls === 0;
    record("the process map is one connected graph (1 component, 1 entry step, 1 final step), every path drawn", ok,
      "nodes=" + connProbe.nodes + " edges=" + connProbe.edges + "/" + connProbe.runEdges +
      " all=" + connProbe.allDrawn + "/" + connProbe.allEdges + " components=" + connProbe.components +
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
  // (the OS save dialog is stubbed to a temp path, the shell reveal to a
  // recorder: AD-29, every export opens its folder at the file).
  async function exportViaMenu(itemId, outPath) {
    await app.evaluate(({ dialog, shell }, p) => {
      global.__pdtSaveDefault = null;
      global.__pdtRevealed = null;
      dialog.showSaveDialog = async (_w, opts) => {
        global.__pdtSaveDefault = (opts && opts.defaultPath) || null;
        return { canceled: false, filePath: p };
      };
      shell.showItemInFolder = (f) => { global.__pdtRevealed = f; };
    }, outPath);
    await page.click("#btn-session-export-menu");
    await page.click("#" + itemId);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) break;
      await wait(250);
    }
    const suggested = await app.evaluate(() => global.__pdtSaveDefault).catch(() => null);
    // The reveal follows the write: give it a moment to land.
    const revealBy = Date.now() + 5000;
    let revealed = null;
    while (Date.now() < revealBy && !(revealed = await app.evaluate(() => global.__pdtRevealed).catch(() => null))) await wait(100);
    const text = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
    try { fs.unlinkSync(outPath); } catch (_) {}
    return { bytes: text.length, head: text.slice(0, 200), text, suggested,
      revealed: !!revealed && path.resolve(revealed).toLowerCase() === path.resolve(outPath).toLowerCase() };
  }
  // Start from Overview: the image is drawn off screen from the step BPMN, as
  // the PDD draws its map (AD-32), so the analyst stays where they are. It
  // may analyze first (the steps newer than the BPMN file), so FRESH only.
  await page.click('.view-mode-btn[data-level="overview"]').catch(() => {});
  await wait(600);
  if (!FRESH) {
    record("AD-11: Export > Process map (image) (skipped: session not re-normalized)", true,
      "the export may analyze into the committed demo folder");
  } else {
    const svgOut = path.join(os.tmpdir(), "pdt-e2e-map-" + Date.now() + ".svg");
    const svgRes = await exportViaMenu("btn-session-map-svg", svgOut);
    const svgStayed = await page.evaluate(() => {
      const layout = document.getElementById("session-layout-overview");
      return !!(layout && getComputedStyle(layout).display !== "none" && require("./state.js").getLevel() === "overview");
    }).catch(() => false);
    const svgOk = svgRes.bytes > 0 && /<svg[\s>]/.test(svgRes.text) && /created with bpmn-js/.test(svgRes.text) &&
      /\.svg$/.test(svgRes.suggested || "") && svgStayed && svgRes.revealed;
    record("AD-11 + AD-29 + AD-32: Export > Process map (image), with no As-Is copy chosen, saves the step BPMN drawn by bpmn-js (the PDD's map) as an SVG file from the Overview, which stays, and opens its folder at the file",
      svgOk, "bytes=" + svgRes.bytes + " suggested=" + svgRes.suggested + " stayed=" + svgStayed + " revealed=" + svgRes.revealed +
        " head=" + JSON.stringify(svgRes.head.slice(0, 80)));
    if (!svgOk) await shot(page, "fail-export-map-svg.png");
  }
  if (!FRESH) {
    record("AD-11: Export > Process map (BPMN) (skipped: session not re-normalized)", true,
      "the export would analyze into the committed demo folder");
  } else {
    const bpmnOut = path.join(os.tmpdir(), "pdt-e2e-step-" + Date.now() + ".bpmn");
    const bpmnRes = await exportViaMenu("btn-session-step-bpmn", bpmnOut);
    const bpmnOk = bpmnRes.bytes > 0 && /<(?:[\w-]+:)?definitions[\s>]/.test(bpmnRes.text) &&
      /<(?:[\w-]+:)?(?:task|userTask)[\s>]/.test(bpmnRes.text) && /\.bpmn$/.test(bpmnRes.suggested || "") && bpmnRes.revealed;
    record("AD-11 + AD-29: Export > Process map (BPMN), with no As-Is copy chosen, writes the step-level BPMN file and opens its folder at the file",
      bpmnOk, "bytes=" + bpmnRes.bytes + " suggested=" + bpmnRes.suggested + " revealed=" + bpmnRes.revealed +
        " head=" + JSON.stringify(bpmnRes.head.slice(0, 80)));
    if (!bpmnOk) await shot(page, "fail-export-step-bpmn.png");
  }

  // --- ADR-0019 Reference Maps round-trip pin ---------------------------------
  // An edited map is a decoupled, editable BPMN copy of the process map. The
  // honest-leaf contract has a full lifecycle: the Map's one act (it analyzes
  // first when the steps changed, then copies; the copy is a one-way leaf) ->
  // Edit (full bpmn-js palette) -> Save (debounced saveXML to
  // derived_maps/<id>.bpmn) -> reload (reopen re-reads the blob) -> Delete+Undo
  // (the file leaves with the row, lane CC; Ctrl+Z restores both, a WORKING,
  // still-edited entry).
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
    // P1.7 + P2.16 + 2.0.1: the step detail in parts, each fact once: In the
    // PDD (the system in its field, the Description resident), Screenshots,
    // Notes, Attachments and Recorded (its line: the actions, the screen, the
    // time, where the draft ends); no fact line, no fields typed, no Start,
    // End or Run tiles; the step's own screenshots, stamped on the one clock.
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
        // One clock: the time since the recording started (m:ss).
        const origin = Date.parse(s.manifest.started_at);
        const local = (iso) => { const t = Math.floor((Date.parse(iso) - origin) / 1000); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
        const at = {};
        for (const e of s.events || []) if (e.type === "system" && e.data && e.data.path) at[e.data.path] = e.timestamp;
        const desc = document.getElementById("step-desc");
        const sys = document.getElementById("step-system");
        const parts = ["step-doc", "step-shots-sect", "step-recorded"].map((id) => document.getElementById(id));
        return {
          recorded: ((document.querySelector("#step-recorded > summary .step-part-hint") || {}).textContent || "").trim(),
          facts: ((document.querySelector("#step-facts .step-facts-rest") || {}).textContent || "").trim(),
          // Where the step is: its run's number and its start on the one clock.
          wantWhere: (() => {
            const runs = ((s.stats && s.stats.case_stats) || []).filter((c) => !c.parent_case_id)
              .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts));
            return "Transaction " + (runs.findIndex((c) => c.case_id === step.case_id) + 1) + " at " + local(step.time_range.start);
          })(),
          system: sys ? (sys.value || sys.placeholder) : "",
          parts: parts.every(Boolean) && parts.every((el, i) => !i || !!(parts[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)),
          gone: document.querySelectorAll("#step-detail .step-fact, #step-detail .step-fields, #step-detail .si-legend, #step-detail .si-identity").length,
          actions: ((step.evidence && step.evidence.interaction_event_ids) || []).length,
          tiles: document.querySelectorAll("#step-detail .stat-tile, #step-detail .step-suggestion-reason").length,
          descResident: !!(desc && getComputedStyle(desc).display !== "none"),
          refs: (step.evidence.screenshot_refs || []).length,
          shots: [...document.querySelectorAll("#step-detail .step-shot")].map((b) => ({
            ref: b.dataset.ref, loaded: (b.querySelector("img") || {}).naturalWidth > 0,
            stamp: ((b.querySelector(".stamp") || {}).textContent || "").trim() })),
          wantStamps: (step.evidence.screenshot_refs || []).map((r) => (at[r] ? local(at[r]) : "")),
          // Where the draft ends: its commit, named as the drafting names it
          // (step_suggest._commit_label: the vocabulary's name, else the
          // control's name, else its type), from the step's last interaction.
          // (The pipeline's suggestion_reason had no reader and is cut, lane FX1.)
          wantEnds: (() => {
            if (step.end_reason !== "commit") return null;
            const ids = (step.evidence && step.evidence.interaction_event_ids) || [];
            const last = (s.events || []).find((e) => e.type === "interaction" && e.event_id === ids[ids.length - 1]);
            const d = (last && last.data) || {};
            const label = String(d.meaningful_name || d.name || d.control_type || "").trim();
            return label ? "ends at " + label : null;
          })(),
          saveButton: !!document.getElementById("btn-step-save"),
        };
      }, detail.stepId));
    } catch (e) { logActionError("P1.7 + P2.16 step detail", e); detail.err = String(e.message).split("\n")[0]; }
    const detailOk = !!(!detail.err && /^(Salesforce|SAP|Excel|Outlook|Notepad)$/.test(detail.system || "") &&
      detail.wantEnds && detail.recorded === detail.actions + " action" + (detail.actions === 1 ? "" : "s") + " \u00b7 " + detail.wantEnds &&
      (detail.facts || "").includes(detail.wantWhere + " \u00b7 took ") &&
      detail.parts && detail.gone === 0 &&
      detail.tiles === 0 && detail.descResident && !detail.saveButton &&
      detail.shots && detail.shots.length === detail.refs && detail.refs > 0 && detail.shots.every((x) => x.loaded) &&
      JSON.stringify(detail.shots.map((x) => x.stamp)) === JSON.stringify(detail.wantStamps));
    record("P1.7 + P2.16 + V2 item 1 + 2.0.1: the step editor in the order of the work (what you write, the screenshots, Recorded), each fact once: the system in its field first on the line of facts (then the screen, Transaction N at m:ss, took the time), the Recorded line (N actions · ends at its commit), no fact line, no fields typed, no legend, no Save button, the Description resident, and the step's own screenshots (loaded, stamped with the time since the recording started); no Start, End or Run tiles",
      detailOk, JSON.stringify(detail));
    if (!detailOk) await shot(page, "fail-step-detail.png");

    const PROBE = "RT_PIN_EDIT"; // a label no mined node carries
    const stepBpmn = path.join(SESSION, "process_map_step.bpmn");
    // F1 + AD-19: the Map's one act makes the As-Is map from the step names as
    // they are now. A pattern-run draft is renamed in Steps first (the
    // analyst's verb, the detail form), so the steps are newer than the map's
    // BPMN file: the act analyzes first (busy meanwhile), and the editor opens
    // on the process map with the new name, not the draft's. Lane MV: the
    // copy is kept at its first change.
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
      await page.locator("#step-name").press("Enter");   // no Save button: Enter saves the name
      await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")]
        .some((e) => e.textContent.trim() === n), RENAMED, { timeout: STATE_TIMEOUT });
      f1.bpmnHadOld = fs.readFileSync(stepBpmn, "utf-8").includes(OLD);
      f1.annoNewer = fs.statSync(path.join(SESSION, "annotations.json")).mtimeMs > fs.statSync(stepBpmn).mtimeMs;
      await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: STATE_TIMEOUT });
      f1.mapBusy = await page.evaluate(() => require("./refmap-ui.js").mapBusy());
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
      await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: STATE_TIMEOUT });
      await wait(900);
    } catch (e) { logActionError("F1 rename, then the Map's edit act", e); f1.err = String(e.message).split("\n")[0]; }
    // The Map's analysis rewrote the map's file; from here on nothing may
    // touch it (the one-way leaf check below).
    const stepXml = fs.existsSync(stepBpmn) ? fs.readFileSync(stepBpmn, "utf-8") : null;
    const minedBefore = stepXml != null ? fs.statSync(stepBpmn).size + ":" + stepXml.length : null;
    const derivedCount = () => (fs.existsSync(path.join(SESSION, "derived_maps")) ? fs.readdirSync(path.join(SESSION, "derived_maps")).length : 0);
    // The editor on the new copy, before any change: nothing is kept yet.
    const opened = await page.evaluate((a) => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      const s = State.getSession();
      const host = document.getElementById("refmap-editor-host");
      const overlay = document.getElementById("refmap-editor-overlay");
      const palette = host && host.querySelector(".djs-palette");
      const v = host && host.__bpmnViewer;
      const names = v ? v.get("elementRegistry").filter((e) => /Task$/.test(e.type)).map((e) => e.businessObject.name || "") : [];
      return {
        count: RM.list(s.annotations).length,
        editorPdd: (document.getElementById("refmap-editor-pdd") || {}).value,
        editorName: (document.getElementById("refmap-editor-name") || {}).value,
        editorControls: ["refmap-editor-kind", "refmap-editor-badge", "refmap-editor-prov"].filter((id) => document.getElementById(id)),
        newName: names.includes(a.renamed), oldName: names.includes(a.old),
        editorOpen: !!(overlay && overlay.style.display !== "none"),
        editorSvg: !!(host && host.querySelector("svg")),
        paletteVisible: palette ? getComputedStyle(palette).display !== "none" : false,
      };
    }, { renamed: RENAMED, old: OLD }).catch((e) => ({ err: e.message }));
    opened.files = derivedCount();
    const openOk = !!(opened && !opened.err && opened.editorOpen && opened.editorSvg && opened.paletteVisible &&
      opened.editorName === "As-Is map" && opened.editorPdd === "as_is" && opened.editorControls.length === 0 &&
      opened.count === 0 && opened.files === 0 && f1.button && f1.button.text === "Edit as the As-Is map" && f1.button.primary);
    record("AD-19 + P1.12 + lane MV: the Map's one act, Edit as the As-Is map, opens the process map in the editor as the PDD's As-Is map (one role control); nothing is kept before a change",
      openOk, JSON.stringify({ button: f1.button, opened }));
    // The Map shows how the transactions ran here (the connectivity pin chose
    // that view), which needs no analysis: the act analyzes itself. On the
    // process map the Map analyzes as it opens and the act waits for it
    // (map-slim-smoke.js (m2)); busy either way.
    const f1Ok = !!(!f1.err && f1.bpmnHadOld && f1.annoNewer && f1.busy &&
      opened && opened.newName && !opened.oldName && !!stepXml && stepXml.includes(RENAMED));
    record("F1 + lane MV: after a rename the act analyzes first (busy meanwhile; or waits for the Map's own update), and the editor opens on the process map with the new step name, not the draft's",
      f1Ok, JSON.stringify({ err: f1.err, bpmnHadOld: f1.bpmnHadOld, annoNewer: f1.annoNewer, mapBusy: f1.mapBusy,
        busy: f1.busy, newName: opened && opened.newName, oldName: opened && opened.oldName }));
    if (!(openOk && f1Ok)) await shot(page, "fail-refmap-fork.png");

    // Edit: a real, undoable bpmn-js label change keeps the copy and fires
    // the debounced disk save.
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
    // Lane MV: the first change kept the copy, made from the step map as it
    // is now (its provenance), as the PDD's As-Is map.
    const kept = await page.evaluate((src) => {
      const State = require("./state.js"), RM = require("./reference-maps.js");
      const s = State.getSession(), e = RM.list(s.annotations)[0] || null;
      return {
        count: RM.list(s.annotations).length,
        fileOnDisk: e ? RM.fileExists(s.sessionFolder, e) : false,
        sourceLevel: e && e.source ? e.source.level : null,
        fromStepMap: !!(e && e.forked_from_hash && e.forked_from_hash === RM.fileHash(src)),
        name: e && e.name, pddRole: e && e.pdd_role,
      };
    }, stepBpmn).catch((e) => ({ err: e.message }));
    kept.onDisk = (JSON.parse(fs.readFileSync(path.join(SESSION, "annotations.json"), "utf-8")).reference_maps || []).length;
    kept.files = derivedCount();
    record("lane MV: the first change keeps the copy: one entry, on disk too (As-Is map, the PDD's As-Is map, made from the step map as it is now), its one file carrying the change",
      !!(edited.ok && kept && !kept.err && kept.count === 1 && kept.onDisk === 1 && kept.files === 1 && kept.fileOnDisk &&
        kept.sourceLevel === "step" && kept.fromStepMap && kept.name === "As-Is map" && kept.pddRole === "as_is" && savedToDisk),
      JSON.stringify({ edited: edited.ok, kept, savedToDisk }));

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
    // Lane FX3: they are text tools now (.tool-btn), in the text face.
    const clipped = await page.evaluate(() => {
      const sels = [".refmap-row-actions button", "#btn-fork-refmap", "#btn-toggle-refmaps",
        "#btn-session-map-zoom-fit"];
      const bad = [];
      const rows = document.querySelectorAll(".refmap-row-actions button");
      if (!rows.length) bad.push("no row button to check");
      document.querySelectorAll(".refmap-row-actions button, #btn-toggle-refmaps, #btn-session-map-zoom-fit, #btn-session-map-reset-layout")
        .forEach((b) => {
          if (b.classList.contains("icon-btn")) bad.push((b.textContent || "").trim() + " is in an icon square");
          if (/mono/i.test(getComputedStyle(b).fontFamily)) bad.push((b.textContent || "").trim() + " in the monospace face");
        });
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

    // Inverse: Delete drops the row and (lane CC) its file leaves
    // derived_maps/ with the save; one Ctrl+Z restores a WORKING entry, its
    // file back and still carrying the edit (the COHERENCE-AUDIT requirement).
    const delUndo = await page.evaluate(async (probe) => {
      const State = require("./state.js"), RM = require("./reference-maps.js"), Session = require("./session.js");
      const s = State.getSession();
      const m = RM.list(s.annotations)[0];
      if (!m) return { err: "no map to delete" };
      const fileBefore = RM.fileExists(s.sessionFolder, m);
      RM.destroy({ sessionFolder: s.sessionFolder, anno: s.annotations, id: m.map_id });
      await Session.saveAnnotationsWithUndo(s.annotations, "Delete reference map");
      const afterDel = RM.list(s.annotations).length;
      const fileAfterDel = RM.fileExists(s.sessionFolder, m);
      await Session.performUndo();
      const restored = RM.list(s.annotations)[0] || null;
      const xml = restored ? RM.readBpmn(s.sessionFolder, restored) : null;
      return {
        fileBefore, afterDel, fileAfterDel, afterUndo: RM.list(s.annotations).length,
        fileBack: !!(restored && RM.fileExists(s.sessionFolder, restored)),
        restoredHasEdit: !!(xml && xml.indexOf(probe) !== -1),
      };
    }, PROBE).catch((e) => ({ err: e.message }));
    const invOk = delUndo && !delUndo.err && delUndo.fileBefore && delUndo.afterDel === 0 && delUndo.fileAfterDel === false &&
      delUndo.afterUndo === 1 && delUndo.fileBack && delUndo.restoredHasEdit;
    record("reference map: Delete takes the copy and its file in derived_maps/ out; Ctrl+Z restores both, the edit kept (inverse)", invOk,
      JSON.stringify(delUndo));
    if (!invOk) await shot(page, "fail-refmap-undo.png");

    // Decoupled leaf: after the Map's own analysis (lane MV), nothing above
    // touched the step-level BPMN on disk.
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

  // --- Item 6, D4: an inserted marker shows at once where it was put, and a
  // moment later it applies by itself in a recording too (no Apply button,
  // no question, no message when it worked): the marker is a real one and
  // the case count follows. Analyzes into the session folder, so FRESH only.
  if (!FRESH) {
    record("item 6: marker insert applied by itself (skipped: session not re-normalized)", true,
      "the analysis would write into the committed demo folder");
  } else {
    await markerInsertPin();
  }

  async function markerInsertPin() {
    const T = 20000;
    const LABEL = "E2E new run";
    const INSERT_AT = "2026-05-14T09:01:20.000Z";   // the gap between the demo's first two runs
    const cases = () => page.evaluate(() => ({
      analyzed: ((require("./state.js").getSession().analysis || {}).case_quality || {}).case_count,
      bands: document.querySelectorAll("#timeline .tl-case-band").length,
      runsLine: ((document.querySelector('#ov-summary [data-summary="runs"]') || {}).textContent || "").trim(),
      stepsRuns: document.querySelectorAll("#step-list .run-group").length,
    }));
    // Lane PANE: the Markers list is gone; the insert opens the pane's Steps
    // tab, and once applied the new transaction has its header there.
    const pinState = () => page.evaluate((label) => {
      const head = [...document.querySelectorAll("#tp-steps .tp-tx-name")].find((r) => (r.textContent || "").includes(label));
      const panel = document.querySelector('.anno-panel[data-panel="steps"]');
      const band = [...document.querySelectorAll("#timeline .tl-case-band")].find((b) => (b.title || "").includes(label)) || null;
      return {
        row: head ? { text: (head.textContent || "").replace(/\s+/g, " ").trim() } : null,
        markersPanelShown: !!(panel && getComputedStyle(panel).display !== "none") &&
          document.getElementById("tp-tab-steps").getAttribute("aria-selected") === "true",
        // D4: no line through the lanes and no state of its own: the band
        // stands where it was put, drawn as any transaction is.
        bars: document.querySelectorAll("#timeline .tl-marker").length,
        band: band ? { cls: band.className, title: band.title } : null,
        update: !!document.getElementById("btn-update-steps"),
        statusText: ((document.getElementById("session-pills") || {}).textContent || "").trim(),
      };
    }, LABEL);
    // Every question and message from the insert on: none asks, and the run
    // says nothing when it worked.
    const watchSaid = () => page.evaluate(() => {
      window.__d4 = { confirms: 0, toasts: [] };
      const t = document.getElementById("toast");
      new MutationObserver(() => { const x = (t.textContent || "").trim(); if (x && window.__d4.toasts[window.__d4.toasts.length - 1] !== x) window.__d4.toasts.push(x); })
        .observe(t, { childList: true, subtree: true, characterData: true });
      new MutationObserver(() => { if (document.querySelector(".modal-confirm")) window.__d4.confirms++; })
        .observe(document.body, { childList: true, subtree: true });
    });
    let before = null, drawn = null, applied = null, onDisk = false, err = null;
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
      await page.locator("#tl-ctx-menu div", { hasText: "Start a transaction here" }).click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill(LABEL, { timeout: T });
      await watchSaid();
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      await page.waitForFunction((label) => [...document.querySelectorAll("#timeline .tl-case-band")]
        .some((b) => (b.title || "").includes(label)), LABEL, { timeout: T });
      drawn = Object.assign(await pinState(), { cases: await cases() });
      // Saved as an insert edit near INSERT_AT (the right-click x maps to a
      // time through the timeline's pixel width, so allow 2 s either way).
      const a = JSON.parse(fs.readFileSync(path.join(SESSION, "annotations.json"), "utf-8"));
      onDisk = (a.marker_edits || []).some((e) => e && e.op === "insert" && e.marker_type === "start" &&
        e.label === LABEL && Math.abs(Date.parse(e.timestamp) - Date.parse(INSERT_AT)) <= 2000);
    } catch (e) { logActionError("item 6 marker insert", e); err = String(e.message).split("\n")[0]; }
    const drawnOk = !!(drawn && !drawn.row &&
      drawn.markersPanelShown && drawn.bars === 0 && drawn.band &&
      drawn.band.cls === "tl-case-band" && !/applied|Apply|pending/i.test(drawn.band.title) &&
      !drawn.update && !/Apply/.test(drawn.statusText) && onDisk &&
      drawn.cases.analyzed === before.analyzed && drawn.cases.bands === before.bands + 1);
    record("item 6, lane PANE, D4: a Start marker inserted from the timeline menu is drawn at once where it was put, as any transaction band (no dashed state, no line, nothing about applying in its tooltip), with no Apply button; the pane's Steps tab shown, no header yet, before its analysis",
      drawnOk, JSON.stringify({ before, drawn, onDisk, err }));
    if (!drawnOk) await shot(page, "fail-marker-drawn.png");

    // D4: it applies by itself a moment later, with no click and no
    // question; meanwhile the top bar says "Updating steps and map..." with
    // Cancel, no log shows, and nothing is said when it worked.
    let statusLine = null, said = null;
    try {
      statusLine = await page.waitForFunction(() => {
        const line = document.getElementById("run-status"), cancel = document.getElementById("btn-cancel-normalize");
        const t = line && cancel ? (line.textContent || "").trim() + " | " + (cancel.textContent || "").trim() : "";
        return t === "Updating steps and map... | Cancel" && !!line.closest("#session-pills") ? t : false;
      }, null, { timeout: T }).then((h) => h.jsonValue(), () => null);
      statusLine = { text: statusLine, logShown: await page.$eval("#log-host", (el) => getComputedStyle(el).display !== "none") };
      await page.waitForFunction((label) => !document.getElementById("run-status") &&
        [...document.querySelectorAll("#tp-steps .tp-tx-name")].some((r) => (r.textContent || "").includes(label)),
      LABEL, { timeout: 120000 });
      applied = Object.assign(await pinState(), { cases: await cases() });
      said = await page.evaluate(() => window.__d4);
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
    } catch (e) { logActionError("item 6 applied by itself", e); err = String(e.message).split("\n")[0]; }
    const appliedOk = !!(applied && before && applied.row &&
      applied.bars === 0 && !applied.update &&
      applied.cases.analyzed === before.analyzed + 1 && applied.cases.bands === before.bands + 1 &&
      // The Overview names the runs the Steps level lists; both follow the new
      // analysis.
      applied.cases.runsLine === applied.cases.stepsRuns + " transactions" &&
      before.runsLine === before.stepsRuns + " transactions");
    record("item 6, D4: with no click and no question the insert applies by itself in a recording: the top bar says Updating steps and map... with Cancel (no log), nothing is said when it worked (\"Transaction started at m:ss.\" the only message), and the marker becomes a real one: the case count goes up by one, and its transaction has its header in the pane's Steps tab",
      appliedOk && !!statusLine && statusLine.text === "Updating steps and map... | Cancel" && statusLine.logShown === false &&
        !!said && said.confirms === 0 && said.toasts.length === 1 && /^Transaction started at \d+:\d\d[.]$/.test(said.toasts[0]),
      JSON.stringify({ before: before && before.analyzed, applied, said, statusLine, err }));
    const rb = applied && applied.runBand;
    record("runs never nest on the timeline: the inserted run's band ends where the next run starts, on the same row (the pipeline's rule)",
      !!(rb && !rb.dangling && rb.nextLeft != null && Math.abs(rb.right - rb.nextLeft) <= 2 && rb.top === rb.nextTop),
      JSON.stringify(rb));
    if (!appliedOk) await shot(page, "fail-marker-applied.png");
  }

  // --- P2.11: Sync video and Add step come with a video ----------------------
  // A copy of the analyzed session with a video linked (annotations
  // external_video: any existing file, the check is the controls, not
  // playback), opened in the same viewer: the video pane's header offers Sync
  // video and the Timeline offers Add step. Opened again without it, both go.
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
      vid.with = await placed();
      await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), SESSION);
      vid.after = await placed();
    } catch (e) { logActionError("P2.11 with a video", e); vid.err = String(e.message).split("\n")[0]; }
    record("P2.11: with a video linked, the video header offers Sync video, the recording line Replace, and the Timeline Add step; without one again, they go",
      !!(!vid.err && vid.recording && vid.with.syncVideo.shown && vid.with.syncVideo.inHeader &&
        vid.with.syncVideo.text === "Sync video..." && vid.with.addStep && vid.with.attachVideo.text === "Replace" &&
        vid.after.syncVideo.shown === false && vid.after.addStep === false && vid.after.attachVideo.text === "Attach"),
      JSON.stringify(vid));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
  }

  // --- Lane CC: a stretch left out of the analysis, on the Timeline --------
  // Shift-drag over transaction 2's first steps, Leave out of the analysis:
  // the Timeline draws the stretch hatched with its legend, its steps are
  // not drafted, and transaction 2 says once that part of it was left out
  // (its reference steps inside the stretch are not skipped). A click on the
  // band offers Include again, which brings the steps back; Ctrl+Z and
  // Ctrl+Y take either back, each with its analysis.
  if (FRESH) {
    const lo = {};
    const T = 20000;
    const idle = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
    const pickRun = () => page.evaluate(() => {
      const s = require("./state.js").getSession();
      const RM = require("./runs-model.js");
      const runs = RM.buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
      const ref = RM.patternRun(s.annotations || {}, runs).run;
      const r = runs.find((x) => x !== ref && x.visible.length >= 4 && x.visible.every((st) => st.time_range));
      return r ? { caseId: r.caseId, title: r.title } : null;
    });
    let RUN = null;
    const probe = () => page.evaluate((cid) => {
      const s = require("./state.js").getSession();
      const RM = require("./runs-model.js");
      const runs = RM.buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
      const run = runs.find((x) => x.caseId === cid);
      const band = document.querySelector("#timeline .tl-left-out");
      const lg = document.querySelector("#lanes-legend .lg-left-out");
      return {
        ranges: ((s.annotations || {}).excluded_ranges || []).map((r) => [r.start, r.end]),
        run2: run ? { start: run.startMs, end: run.endMs, steps: run.visible.length,
          starts: run.visible.map((x) => Date.parse(x.time_range && x.time_range.start)) } : null,
        band: band ? { title: band.title, label: ((band.querySelector(".tl-left-out-label") || {}).textContent || ""),
          start: band.dataset.start, end: band.dataset.end } : null,
        legend: !!(lg && getComputedStyle(lg).display !== "none"),
      };
    }, RUN && RUN.caseId);
    try {
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: STATE_TIMEOUT });
      await idle();
      RUN = await pickRun();
      lo.run = RUN;
      lo.before = await probe();
      // From just before transaction 2 starts to the end of its third step.
      const target = await page.evaluate((cid) => {
        const s = require("./state.js").getSession();
        const runs = require("./runs-model.js").buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
        const r = runs.find((x) => x.caseId === cid), third = r.visible[2];
        const evs = s.events, f = Date.parse(evs[0].timestamp), l = Date.parse(evs[evs.length - 1].timestamp);
        const a = r.startMs - 400, b = Date.parse(third.time_range.end) + 400;
        const host = document.getElementById("timeline");
        host.scrollIntoView({ block: "center" });
        const rect = host.getBoundingClientRect();
        const xa = rect.left + ((a - f) / (l - f)) * rect.width, xb = rect.left + ((b - f) / (l - f)) * rect.width;
        // A point of the timeline's own background at both x (the drag starts there).
        let y = null;
        for (let yy = rect.bottom - 3; yy > rect.top; yy -= 2) {
          if (document.elementFromPoint(xa, yy) === host && document.elementFromPoint(xb, yy) === host) { y = yy; break; }
        }
        return { xa, xb, y, names: r.visible.slice(0, 3).map((x) => x.name) };
      }, RUN.caseId);
      lo.target = target;
      await page.keyboard.down("Shift");
      await page.mouse.move(target.xa, target.y);
      await page.mouse.down();
      await page.mouse.move((target.xa + target.xb) / 2, target.y, { steps: 4 });
      await page.mouse.move(target.xb, target.y, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      lo.card = ((await page.locator("#tl-selection-exclude").textContent({ timeout: T })) || "").trim();
      await page.locator("#tl-selection-exclude").click({ timeout: T });
      await page.waitForSelector(".modal-confirm", { state: "visible", timeout: T });
      lo.confirm = ((await page.locator(".modal-confirm").textContent({ timeout: T })) || "").replace(/\s+/g, " ").trim();
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await page.waitForSelector("#timeline .tl-left-out", { timeout: T });
      await idle();
      await page.waitForSelector("#timeline .tl-left-out", { timeout: T });
      lo.left = await probe();
      await shot(page, "cc-left-out-band.png");
      // Transaction 2 in Steps: the one line first, no Skipped for the steps inside.
      await page.evaluate((cid) => {
        const s = require("./state.js").getSession();
        const runs = require("./runs-model.js").buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
        const r = runs.find((x) => x.caseId === cid);
        const first = r && r.visible[0];
        require("./state.js").setSelectedStepId(first ? first.step_id : null);
      }, RUN.caseId);
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      // Lane FX1: the left-out line is said above the steps, in its own
      // list, so the head counts only the differences (2.0.1: those are on
      // the rows, each titled with its line).
      await page.waitForSelector("#step-list .run-group.open .run-notes li", { timeout: T });
      lo.diffs = await page.evaluate(() => [...document.querySelectorAll("#step-list .run-group.open .run-notes li")]
        .map((li) => ({ kind: li.dataset.kind, text: li.textContent, list: "run-notes" }))
        .concat([...document.querySelectorAll("#step-list .run-group.open .step-row:not(.step-ghost) .step-diff")]
          .map((el) => ({ kind: (/step-diff-(\w+)/.exec(el.className) || [])[1], text: el.getAttribute("title") || "", list: "row" })))
        .concat([...document.querySelectorAll("#step-list .run-group.open .step-ghost")]
          .map((el) => ({ kind: el.dataset.ghost, text: el.getAttribute("title") || "", list: "row" }))));
      lo.openRun = await page.evaluate(() => (document.querySelector("#step-list .run-group.open .run-title") || {}).textContent);
      lo.head = await page.evaluate(() => ((document.querySelector("#step-list .run-group.open .run-meta") || {}).textContent || "").trim());
      // Lane FX1 (report 2, item 3): the stretch opens transaction 2, so its
      // trace is cut there: neither the live map nor the step BPMN draws a
      // path from the start straight into the step after the stretch.
      lo.after = await page.evaluate((cid) => {
        const s = require("./state.js").getSession();
        const RM = require("./runs-model.js"), PML = require("./process-map-levels.js");
        const runs = RM.buildRuns(s.stats, (s.annotations || {}).steps || []).runs;
        const r = runs.find((x) => x.caseId === cid);
        const firsts = runs.filter((x) => x !== r && x.visible.length).map((x) => PML.mapNodeLabel(x.visible[0]));
        return { first: r && r.visible.length ? PML.mapNodeLabel(r.visible[0]) : null, others: firsts };
      }, RUN.caseId);
      await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
      await showRuns(page);
      lo.liveStarts = await page.evaluate(() => {
        const cy = (document.getElementById("session-map-dfg-host") || {}).__cy;
        return cy ? cy.edges().filter((e) => e.source().data("role") === "start-event").map((e) => e.target().id()) : null;
      });
      lo.bpmnStarts = bpmnFirstTasks(path.join(SESSION, "process_map_step.bpmn"));
      await shot(page, "fx1-left-out-live-map.png");
      // Include again, from the band's own menu (lane LANES: the hatch runs
      // through every lane under the marks; a click where no mark is).
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector("#timeline .tl-left-out", { timeout: T });
      await page.mouse.click(...(await page.evaluate(() => {
        const h = document.querySelector("#timeline .tl-left-out"), r = h.getBoundingClientRect(), x = r.left + r.width / 2;
        for (let y = r.bottom - 2; y > r.top; y -= 2) if (document.elementFromPoint(x, y) === h) return [x, y];
        return [x, r.bottom - 2];
      })));
      lo.menu = await page.evaluate(() => [...document.querySelectorAll("#tl-ctx-menu > div")].map((d) => d.textContent));
      await page.locator("#tl-ctx-menu div", { hasText: "Include again" }).click({ timeout: T });
      await page.waitForFunction(() => !document.querySelector("#timeline .tl-left-out"), null, { timeout: T });
      await idle();
      lo.included = await probe();
      // Ctrl+Z puts the stretch back (and analyzes); Ctrl+Y includes it again.
      await page.evaluate(async () => { await require("./session.js").performUndo(); });
      await page.waitForSelector("#timeline .tl-left-out", { timeout: T });
      await wait(300);
      await idle();
      lo.undone = await probe();
      await page.evaluate(async () => { await require("./session.js").performRedo(); });
      await page.waitForFunction(() => !document.querySelector("#timeline .tl-left-out"), null, { timeout: T });
      await wait(300);
      await idle();
      lo.redone = await probe();
    } catch (e) {
      logActionError("CC left out of the analysis", e);
      lo.err = String(e.message).split("\n")[0];
      await shot(page, "fail-cc-left-out.png");
      await page.keyboard.up("Shift").catch(() => {});
    }
    const inside = (st, r) => !!(r && st.some((t) => t >= Date.parse(r[0]) && t <= Date.parse(r[1])));
    const L = lo.left || {}, B = lo.before || {};
    const origin = Date.parse(JSON.parse(fs.readFileSync(path.join(SESSION, "manifest.json"), "utf-8")).started_at);
    const since = (ms) => { const d = Math.floor((ms - origin) / 1000); return Math.floor(d / 60) + ":" + String(d % 60).padStart(2, "0"); };
    const want = L.ranges && L.ranges[0] && L.run2
      ? "Part of this transaction was left out of the analysis (" + since(Math.max(Date.parse(L.ranges[0][0]), L.run2.start)) +
        " to " + since(Math.min(Date.parse(L.ranges[0][1]), L.run2.end)) + ")." : null;
    record("lane CC: Leave out of the analysis (a Shift-drag's card, asked first) draws the stretch on the Timeline, hatched, with its legend; its steps are not drafted",
      !!(!lo.err && lo.card === "Leave out of the analysis" && /Leave this stretch out of the analysis\?/.test(lo.confirm || "") &&
        B.ranges && B.ranges.length === 0 && !B.band &&
        L.ranges && L.ranges.length === 1 && L.band && /^Left out of the analysis, \d+:\d\d to \d+:\d\d: /.test(L.band.title) &&
        L.band.start === L.ranges[0][0] && L.legend &&
        !inside(L.run2.starts, L.ranges[0]) && L.run2.steps < B.run2.steps),
      JSON.stringify({ card: lo.card, confirm: lo.confirm, before: B, left: L, err: lo.err }));
    const skipped = (lo.diffs || []).filter((d) => d.kind === "skipped").map((d) => d.text);
    record("lane CC: the transaction says once, first, that part of it was left out (the times since the recording started), and none of the steps done in the stretch reads as skipped",
      !!(!lo.err && RUN && lo.openRun === RUN.title && lo.diffs && lo.diffs[0] && lo.diffs[0].kind === "left_out" && lo.diffs[0].text === want &&
        lo.diffs.filter((d) => d.kind === "left_out").length === 1 &&
        !((lo.target && lo.target.names) || []).some((n) => skipped.some((t) => t.startsWith("Skipped: " + n + " (")))),
      JSON.stringify({ want, diffs: lo.diffs, inStretch: lo.target && lo.target.names }));
    const A = lo.after || {};
    const cutOk = !!(!lo.err && A.first && !A.others.includes(A.first) && Array.isArray(lo.liveStarts) && lo.liveStarts.length &&
      !lo.liveStarts.includes(A.first) && Array.isArray(lo.bpmnStarts) && lo.bpmnStarts.length && !lo.bpmnStarts.includes(A.first));
    record("lane FX1: a stretch left out at a transaction's start cuts its trace: neither the live map nor the step BPMN draws a path from the start into the step after the stretch",
      cutOk, JSON.stringify({ after: A, liveStarts: lo.liveStarts, bpmnStarts: lo.bpmnStarts }));
    const notes = (lo.diffs || []).filter((d) => d.list === "run-notes");
    const counted = [...new Set((lo.diffs || []).filter((d) => d.list === "row" && d.kind !== "not_done").map((d) => d.text))];
    const headN = /· (\d+) differences?$/.exec(lo.head || "");
    record("lane FX1: the transaction's head counts exactly its differences (2.0.1: marked on its rows); the left-out line is said apart, above them",
      !!(!lo.err && notes.length === 1 && notes[0].kind === "left_out" &&
        (headN ? Number(headN[1]) === counted.length : / · no differences$/.test(lo.head || "") && counted.length === 0)),
      JSON.stringify({ head: lo.head, diffs: lo.diffs }));
    record("lane CC: a click on the band offers Include again, which takes the stretch out of excluded_ranges and drafts its steps again; Ctrl+Z leaves it out again and Ctrl+Y includes it again, each analyzed",
      !!(!lo.err && Array.isArray(lo.menu) && lo.menu[0] === "Include again" &&
        lo.included && lo.included.ranges.length === 0 && !lo.included.band && lo.included.run2.steps === B.run2.steps &&
        lo.undone && lo.undone.ranges.length === 1 && lo.undone.band && lo.undone.run2.steps === L.run2.steps &&
        lo.redone && lo.redone.ranges.length === 0 && !lo.redone.band && lo.redone.run2.steps === B.run2.steps),
      JSON.stringify({ menu: lo.menu, included: lo.included, undone: lo.undone, redone: lo.redone }));
  }

  // --- Lane FX2 (validation pass 2, F10): an app outside the process ------
  // Steps, Apps outside the process...: the dialog names each app by the
  // business systems it stands for (Salesforce, the browser beside it); with
  // Notepad ticked and saved (the analysis runs), the Timeline draws
  // Notepad's bands hatched like a stretch left out, with the tooltip and
  // the legend's entry; unticked again, they are plain.
  if (FRESH) {
    const ap = {};
    const T = 20000;
    const idle = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
    const dialog = async (tick) => {
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      await page.locator("#btn-ignored-apps").click({ timeout: T });
      await page.waitForSelector("#ia-list label", { timeout: T });
      const rows = await page.evaluate(() => [...document.querySelectorAll("#ia-list label")].map((l) => ({
        proc: l.querySelector("input").dataset.proc, name: ((l.querySelector(".ia-system") || {}).textContent || "").trim(),
        app: ((l.querySelector(".ia-app") || {}).textContent || "").trim(), checked: l.querySelector("input").checked })));
      const box = page.locator('#ia-list input[data-proc="notepad.exe"]');
      if (tick) await box.check({ timeout: T }); else await box.uncheck({ timeout: T });
      await page.locator("#ia-save").click({ timeout: T });
      await page.waitForFunction(() => !document.getElementById("ia-save"), null, { timeout: T });
      await wait(300);
      await idle();
      return rows;
    };
    const bands = () => page.evaluate(() => {
      const all = [...document.querySelectorAll("#timeline .tl-activity")];
      const lg = document.querySelector("#lanes-legend .lg-left-out");
      const notepad = all.filter((b) => /^notepad/i.test(b.dataset.app || ""));
      return { notepad: notepad.length, hatched: notepad.filter((b) => b.classList.contains("tl-app-left-out")).length,
        others: all.filter((b) => !/^notepad/i.test(b.dataset.app || "") && b.classList.contains("tl-app-left-out")).length,
        title: notepad[0] ? notepad[0].title.split("\n")[0] : null, legend: !!(lg && getComputedStyle(lg).display !== "none") };
    });
    try {
      ap.rows = await dialog(true);
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector("#timeline .tl-activity", { timeout: T });
      ap.out = await bands();
      await shot(page, "fx2-app-left-out.png");
      await dialog(false);
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector("#timeline .tl-activity", { timeout: T });
      ap.back = await bands();
    } catch (e) { logActionError("FX2 app left out", e); ap.err = String(e.message).split("\n")[0]; }
    const chrome = (ap.rows || []).find((r) => /^chrome/i.test(r.proc)) || {};
    record("lane FX2: Apps outside the process names each app by its business systems (Salesforce, the browser beside it)",
      !!(!ap.err && chrome.name === "Salesforce" && chrome.app === "(Google Chrome)" &&
        (ap.rows || []).some((r) => /^notepad/i.test(r.proc) && r.name === "Notepad" && r.app === "")),
      JSON.stringify({ err: ap.err, rows: ap.rows }));
    record("lane FX2: an app left out of the analysis (Notepad) is drawn hatched on the Timeline, with the tooltip and the legend's entry of a stretch left out; included again, it is plain",
      !!(!ap.err && ap.out && ap.out.notepad > 0 && ap.out.hatched === ap.out.notepad && ap.out.others === 0 &&
        /^Left out of the analysis: Notepad is among the apps outside the process, so its steps are not drafted and its time is not counted\./.test(ap.out.title || "") &&
        ap.out.legend && ap.back && ap.back.hatched === 0 && ap.back.notepad === ap.out.notepad && !ap.back.legend),
      JSON.stringify({ out: ap.out, back: ap.back }));
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
