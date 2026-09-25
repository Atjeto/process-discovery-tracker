"use strict";
/*
 * Overview e2e smoke: the home of a loaded recording (BA-helper cycle; lane
 * V1 of the step-back review).
 *
 * Launches the REAL viewer three times and asserts the Overview end to end:
 *   (a) the DEFAULT level is Overview (#session-layout-overview visible,
 *       its level button active, the Timeline layout hidden), laid out at its
 *       full height (the Session view scrolls; L5b small-screen fix);
 *   (b) the home leads with the Checklist (five acts worded as acts, each
 *       with its tooltip, one button; AD-29), the project line (the
 *       reference transaction's steps, not every one's; the video and the
 *       transcript with their Attach), the document, then the Observations;
 *       the findings feed, its evidence and the "include in PDD" ticks are
 *       gone, and no "More" menu or "Analyze session" button exists anywhere;
 *   (c) the Observations, "Measured from the recording. The PDD prints
 *       them in sections 5 and 6.": Data and Applications and time, the
 *       rows analysis.json holds (pdd_data, pdd_time), cell by cell, and the
 *       exported PDD's own tables equal to them (lane CC, one source);
 *   (c2) the moved controls are where they are used (ids kept);
 *   (c3) "Apply 1 marker change" and its confirmation; Cancel and Ctrl+Z;
 *   (d) the analyst path, walked on the demo: every next act lands where it
 *       says (the reference run open in Steps, each other run open in Steps,
 *       the document open on its first empty field), a done stage shows done,
 *       a field saves undoably, the nine fields (trigger, result and
 *       improvement included) save to annotations.json, the line then shrinks
 *       to one line, the Recents entry takes the title; the export with no
 *       As-Is copy hands the PDD the map from the runs (AD-28), then with an
 *       As-Is and a To-Be copy hands both; the Export menu's map items save
 *       the As-Is copy (P2.12);
 *   (h) Attach video syncs with two clicks (click-to-sync), no typed offset;
 *       Cancel leaves the recording as it was;
 *   (k) lane CC: a step renamed in Steps, the Overview opened: its rows are
 *       measured again (the previous rows meanwhile, "From the last
 *       analysis; refreshing"), then show the new name; a document field
 *       taking the cursor stops that, and the next opening measures them;
 *   (e) on a marker-STRIPPED copy the Checklist says no transactions are
 *       marked, and its button opens the Timeline with the Markers panel
 *       showing;
 *   (g) on a copy never analyzed, the analysis runs by itself on open with
 *       one status line (Updating steps and map... with Cancel) and no log;
 *       an analysis keeps confirmed, edited, added and hidden steps (Leave
 *       apps out runs one by itself); the log shows only when an analysis
 *       fails, its failure sentence first; Cancel stops one;
 *   (f) zero PAGE ERRORs across the launches.
 *
 * Screenshots of the Overview land in this dir (gitignored):
 *   overview-markers-state.png / overview-unsegmented-state.png.
 *
 * Like session-smoke.js it works on TEMP copies so the committed demo is
 * never regenerated in place, and reuses the viewer's own Electron. Unlike
 * session-smoke, a missing deps-bearing Python is a HARD FAIL here: every
 * assertion depends on current pipeline output. It asserts nothing about the
 * PDD's text beyond the document fields it wrote (the PDD lane owns the text).
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

async function launch(sessionDir, pageErrors, ready) {
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
  if (ready !== false) await wait(1500);
  return { app, page, close };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}

/* The entries of a .zip (a .docx is one), read with Node's zlib: the central
   directory names each entry and where its local header sits; the data is
   stored (method 0) or deflated (method 8). zipEntry returns one entry's
   text (null when absent); zipNames lists the entry names. */
function zipCentral(buf, fn) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip: no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("not a zip: bad central directory entry");
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const r = fn(buf.toString("utf8", p + 46, p + 46 + nlen), p);
    if (r !== undefined) return r;
    p += 46 + nlen + xlen + clen;
  }
  return undefined;
}
function readZipEntry(buf, name) {
  const r = zipCentral(buf, (n, p) => {
    if (n !== name) return undefined;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    return (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8");
  });
  return r === undefined ? null : r;
}
/* The tables of a document.xml, each as rows of cell texts (the text runs of
   a cell joined, the XML entities read back). */
function docxTables(xml) {
  const dec = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const text = (frag) => [...frag.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => dec(m[1])).join("");
  return [...String(xml || "").matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)].map((t) =>
    [...t[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) =>
      [...r[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => text(c[1]))));
}
function zipNames(buf) {
  const names = [];
  zipCentral(buf, (n) => { names.push(n); return undefined; });
  return names;
}

const T = 20000;   // the bound on every wait for an observable state
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  // ---- Prepare the sessions (hard prerequisite) ---------------------------
  const SESSION_MARKED = makeTempSession({ stripMarkers: false });
  const SESSION_STRIPPED = makeTempSession({ stripMarkers: true });
  // Never analyzed: events, manifest and annotations only (launch 3).
  const SESSION_RAW = makeTempSession({ stripMarkers: false });
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
  record("(a) default level is Overview (visible, button active+first, Timeline hidden)",
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
    !!(fullHeight && !fullHeight.err && fullHeight.contentH > 200 && fullHeight.contentH <= fullHeight.boxH + 1),
    JSON.stringify(fullHeight));

  // (b) The home: the Checklist first (five acts, one button), the project
  // line next, then the document and the Observations.
  const home = await page.evaluate(() => {
    const host = document.getElementById("overview-content");
    const kids = [...host.children].map((c) => c.id || c.className);
    const line = document.getElementById("ov-next");
    const stages = line ? [...line.querySelectorAll(".ov-next-stage")].map((li) =>
      li.dataset.stage + ":" + (li.classList.contains("done") ? "done" : li.classList.contains("next") ? "next" : "-")) : [];
    const text = host.textContent || "";
    const sum = document.querySelector("#ov-summary .ov-summary-line");
    return {
      kids,
      next: line ? line.dataset.next : null,
      buttons: line ? line.querySelectorAll("button").length : 0,
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
      stages,
      labels: line ? [...line.querySelectorAll(".ov-next-stage")].map((li) => (li.textContent || "").replace("✓", "").trim()) : [],
      tips: line ? [...line.querySelectorAll(".ov-next-stage")].map((li) => (li.title || "").length) : [],
      lineLabel: line ? ((line.querySelector(".ov-next-label") || {}).textContent || "").trim() : null,
      summary: sum ? (sum.textContent || "").replace(/\s+/g, " ").trim() : null,
      summaryH: sum ? Math.round(sum.getBoundingClientRect().height) : null,
      removed: document.querySelectorAll(".ov-tile, .ov-facts, .ov-badge, #ov-mark-runs, .ov-export-bar, " +
        "#btn-ov-export-pdd, #session-summary, .ov-tier2").length,
      // "N of 4 transactions" in the Re-keyed data sentence is how often it happened, not the count.
      runsSaid: (text.match(/(?<!of )\b4 transactions\b/g) || []).length,
      oldWords: (text.match(/\bruns?\b|What is left/gi) || []).length,
      casesSaid: (text.match(/\b4 cases\b/g) || []).length,
      everyRunCount: /\b30 steps\b|steps confirmed/.test(text),
    };
  }).catch((e) => ({ err: e.message }));
  record("(b) AD-29: the home leads with the Checklist (Mark the transactions, Confirm the reference transaction, Review the other transactions, Write the document, Export the PDD, each with its tooltip; the first ticked, next the reference transaction, one button), then the project line, the document and the Observations",
    !!(home && !home.err && same(home.kids, ["ov-next", "ov-summary", "ov-doc", "ov-observations"]) &&
      home.lineLabel === "Checklist" &&
      home.next === "pattern" && home.buttons === 1 && home.button === "Confirm transaction 1 in Steps" &&
      home.stages.join(",") === "runs:done,pattern:next,review:-,document:-,export:-" &&
      same(home.labels, ["Mark the transactions", "Confirm the reference transaction", "Review the other transactions",
        "Write the document", "Export the PDD"]) && home.tips.length === 5 && home.tips.every((n) => n > 40)),
    JSON.stringify(home));
  record("(b2) the project line: the name, who recorded it, the transactions said once and the reference transaction's 7 steps (not 30 over every one), then the video and the transcript with Attach; the removed surfaces stay gone; no run or What is left wording on the home",
    !!(home && !home.err && home.removed === 0 && home.summaryH > 0 && home.summaryH < 40 &&
      home.summary === "demo-order-processing · recorded by demo-worker · 4 transactions · 7 steps in transaction 1 · No video Attach · No transcript Attach" &&
      home.runsSaid === 1 && home.casesSaid === 0 && !home.everyRunCount && home.oldWords === 0),
    JSON.stringify(home && { removed: home.removed, summary: home.summary, summaryH: home.summaryH,
      runsSaid: home.runsSaid, everyRunCount: home.everyRunCount }));

  // (b3) No findings feed, no evidence, no ticks; no More menu and no Analyze
  // session button anywhere in the window.
  const gone = await page.evaluate(() => {
    const n = (sel) => document.querySelectorAll(sel).length;
    const text = (document.body.textContent || "");
    return {
      findings: n(".ov-finding, .ov-finding-group, #overview-evidence, .ov-evidence-section"),
      ticks: n('[data-act="memo"], .ov-memo-check') + n("#overview-content input[type=checkbox]"),
      words: ["include in PDD", "Findings: measured", "Time sinks", "Fragmented attention", "how this was measured"]
        .filter((w) => text.includes(w)),
      more: n("#session-more-menu, #btn-session-more-menu, #session-more-popup") +
        [...document.querySelectorAll("button")].filter((b) => /⋯/.test(b.textContent || "")).length,
      analyze: n("#btn-normalize") + [...document.querySelectorAll("button")].filter((b) => /Analyze session/.test(b.textContent || "")).length,
      actionsBar: n(".actions-bar"),
      log: getComputedStyle(document.getElementById("log-host")).display,
      status: ((document.getElementById("session-pills") || {}).textContent || "").trim(),
    };
  }).catch((e) => ({ err: e.message }));
  record("(b3) no findings, evidence or 'include in PDD' ticks; no More menu, no Analyze session button, no actions bar; an analyzed recording shows no status line and no log",
    !!(gone && !gone.err && gone.findings === 0 && gone.ticks === 0 && gone.words.length === 0 && gone.more === 0 &&
      gone.analyze === 0 && gone.actionsBar === 0 && gone.log === "none" && gone.status === ""),
    JSON.stringify(gone));

  // (c) The Observations (lane CC, one source with the PDD): two items,
  // closed on a fresh profile with their takeaways; opened, Data is the PDD's
  // section 5 and Applications and time its section 6, table by table, as
  // analysis.json holds them (the PDD export below compares them with the
  // document itself).
  const obs = await page.evaluate(async () => {
    const host = document.getElementById("ov-observations");
    if (!host) return { present: false };
    const items = [...host.querySelectorAll(".analysis-module[data-module]")];
    const closed = items.filter((m) => !m.open).length;
    const takeaways = items.map((m) => ((m.querySelector(".analysis-module-takeaway") || {}).textContent || "").trim());
    for (const m of items) if (!m.open) m.querySelector("summary").click();
    await new Promise((r) => setTimeout(r, 100));
    const tablesOf = (el) => [...el.querySelectorAll("table.ov-rows")].map((t) =>
      [...t.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent)));
    const data = host.querySelector('[data-module="data"]'), time = host.querySelector('[data-module="time"]');
    const out = {
      present: true, title: ((host.querySelector(".ov-section-title") || {}).textContent || "").trim(),
      who: ((host.querySelector(".ov-section-head .ov-block-who") || {}).textContent || "").trim(),
      modules: items.map((m) => m.dataset.module),
      titles: items.map((m) => ((m.querySelector(".analysis-module-title") || {}).textContent || "").trim()),
      closed, takeaways,
      dataTables: data ? tablesOf(data) : null,
      rekeyed: data ? [...data.querySelectorAll(".ov-rekeyed li")].map((li) => li.textContent) : null,
      subtitles: [...host.querySelectorAll(".ov-rows-title")].map((d) => d.textContent),
      timeTables: time ? tablesOf(time) : null,
      after: time ? ((time.querySelector(".ov-rows-after") || {}).textContent || "") : null,
      analysis: (() => { const a = require("./state.js").getSession().analysis || {}; return { pdd_data: a.pdd_data, pdd_time: a.pdd_time, format: a.format }; })(),
    };
    for (const m of items) m.querySelector("summary").click();   // close again (the default)
    await new Promise((r) => setTimeout(r, 50));
    try { for (const k of ["data", "time"]) localStorage.removeItem("pdt.analysis." + k); } catch (_) {}
    return out;
  }).catch((e) => ({ err: e.message }));
  record("(c) Observations (\"Measured from the recording. The PDD prints them in sections 5 and 6.\"): two items under the PDD's headings, Data and Applications and time, closed by default with their takeaways",
    !!(obs && !obs.err && obs.present && obs.title === "Observations" &&
      obs.who === "Measured from the recording. The PDD prints them in sections 5 and 6." &&
      same(obs.modules, ["data", "time"]) && same(obs.titles, ["Data", "Applications and time"]) && obs.closed === 2 &&
      obs.takeaways[0] === "Product code (Salesforce) is typed again as Material number (SAP) in every transaction. (+1 more)" &&
      /^Most time in Salesforce: \d+s per transaction$/.test(obs.takeaways[1])),
    JSON.stringify(obs && { title: obs.title, who: obs.who, modules: obs.modules, titles: obs.titles, closed: obs.closed, takeaways: obs.takeaways, err: obs.err }));
  const A = obs && obs.analysis;
  record("(c) Data shows analysis.json's pdd_data cell by cell (the PDD's section 5: Field, System and screen, Step, Example value, Re-keyed), then its Re-keyed data sentences",
    !!(A && A.format === 4 && A.pdd_data && obs.dataTables && obs.dataTables.length === 1 &&
      same(obs.dataTables[0], [A.pdd_data.header].concat(A.pdd_data.rows)) &&
      same(obs.dataTables[0][0], ["Field", "System and screen", "Step", "Example value", "Re-keyed"]) &&
      same(obs.rekeyed, A.pdd_data.rekeyed) && A.pdd_data.rekeyed.length === 2),
    JSON.stringify(obs && { rows: obs.dataTables && obs.dataTables[0] && obs.dataTables[0].length, rekeyed: obs.rekeyed }));
  record("(c) Applications and time shows pdd_time cell by cell: Time per transaction (4 transactions, with the walkthrough line) and Time in each application (Salesforce, never the browser; Notepad in its own row)",
    !!(A && A.pdd_time && obs.timeTables && obs.timeTables.length === 2 &&
      same(obs.timeTables[0], [A.pdd_time.per_transaction.header].concat(A.pdd_time.per_transaction.rows)) &&
      same(obs.timeTables[1], [A.pdd_time.per_application.header].concat(A.pdd_time.per_application.rows)) &&
      obs.timeTables[0].length === 5 && obs.after === A.pdd_time.per_transaction.after &&
      same(obs.subtitles, ["Re-keyed data", "Time per transaction", "Time in each application"]) &&
      obs.timeTables[1].some((r) => r[0] === "Salesforce") && obs.timeTables[1].some((r) => r[0] === "Notepad") &&
      !obs.timeTables[1].some((r) => /Chrome/.test(r[0]))),
    JSON.stringify(obs && obs.timeTables));

  // (c2) The moved controls, where they are used, with their ids.
  const moved = await page.evaluate(() => {
    const at = (id, sel) => { const el = document.getElementById(id); return el ? { text: (el.textContent || "").trim(), where: !!el.closest(sel) } : null; };
    return {
      attachVideo: at("btn-attach-video", "#ov-summary"),
      attachTranscript: at("btn-attach-transcript", "#ov-summary"),
      linkRecording: at("btn-link-recording", "#video-pane #no-video"),
      syncVideo: at("btn-sync-video", "#video-pane .video-controls"),
      ignoredApps: at("btn-ignored-apps", "#session-layout-steps .editor-toolbar"),
      // C21: the Remembered step names dialog is gone (the activity library names steps).
      savedNames: !!document.getElementById("btn-remembered-names"),
      runSelect: !!(document.getElementById("case-scope") || { closest: () => null }).closest("#session-layout-flow .timeline-header"),
    };
  }).catch((e) => ({ err: e.message }));
  record("(c2) the moved controls keep their ids where they are used: Attach video and Attach transcript on the project line, Attach video... on the video band, Sync video... in the video header, Apps outside the process... in the Steps toolbar (no Remembered step names..., contract C21), the Transaction select in the Timeline's header",
    !!(moved && !moved.err && same(moved.attachVideo, { text: "Attach", where: true }) &&
      same(moved.attachTranscript, { text: "Attach", where: true }) &&
      same(moved.linkRecording, { text: "Attach video...", where: true }) &&
      same(moved.syncVideo, { text: "Sync video...", where: true }) &&
      same(moved.ignoredApps, { text: "Apps outside the process...", where: true }) &&
      moved.savedNames === false && moved.runSelect),
    JSON.stringify(moved));

  // (c3) "Apply N marker changes" (the one manual analysis act) and its
  // confirmation; Cancel runs nothing, Ctrl+Z takes the marker back.
  const apply = {};
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await page.waitForSelector("#timeline .tl-band", { state: "visible", timeout: T });
    await page.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
    apply.before = readAnno().marker_edits || [];
    await page.evaluate(() => {
      const tl = document.getElementById("timeline");
      const r = tl.getBoundingClientRect();
      tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
        clientX: r.left + r.width * 0.27, clientY: r.top + 4 }));
    });
    await page.locator("#tl-ctx-menu div", { hasText: "Start a transaction here" }).click({ timeout: T });
    await page.locator(".modal-prompt .modal-input").fill("E2E apply check", { timeout: T });
    await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
    await page.waitForSelector("#btn-apply-marker-edits", { state: "visible", timeout: T });
    apply.cta = ((await page.locator("#btn-apply-marker-edits").textContent({ timeout: T })) || "").trim();
    apply.inBar = await page.evaluate(() => !!document.getElementById("btn-apply-marker-edits").closest("header.topbar"));
    await page.locator("#btn-apply-marker-edits").click({ timeout: T });
    apply.confirm = ((await page.locator(".modal-confirm").textContent({ timeout: T })) || "").replace(/\s+/g, " ").trim();
    await page.locator(".modal-confirm .modal-cancel").click({ timeout: T });
    await wait(500);
    apply.runAfterCancel = ((await page.locator("#session-pills").textContent({ timeout: T })) || "").trim();
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => !document.getElementById("btn-apply-marker-edits"), null, { timeout: T });
    apply.after = readAnno().marker_edits || [];
  } catch (e) { logActionError("(c3) Apply marker changes", e); apply.err = String(e.message).split("\n")[0]; }
  record("(c3) a marker change shows 'Apply 1 marker change' in the top bar; it asks 'Update the drafts of the changed transactions?'; Cancel runs nothing and Ctrl+Z takes the marker back",
    !!(!apply.err && apply.cta === "Apply 1 marker change" && apply.inBar &&
      /^Apply 1 marker change.*Update the drafts of the changed transactions\?.*Your confirmed, edited, added and hidden steps are kept\./.test(apply.confirm) &&
      apply.runAfterCancel === "Apply 1 marker change" && same(apply.after, apply.before)),
    JSON.stringify(apply));
  await page.locator('.view-mode-btn[data-level="overview"]').click({ timeout: T }).catch(() => {});
  await wait(400);

  await shot(page, "overview-markers-state.png");

  // ==== (d) The analyst path, walked: each next act lands where it says ======
  const lineState = () => page.evaluate(() => {
    const line = document.getElementById("ov-next");
    return line ? {
      next: line.dataset.next,
      ready: line.classList.contains("ov-next-ready"),
      label: ((line.querySelector(".ov-next-label") || {}).textContent || "").trim(),
      readyText: ((line.querySelector(".ov-next-ready-text") || {}).textContent || "").trim(),
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
      say: ((line.querySelector(".ov-next-say") || {}).textContent || "").trim(),
      done: [...line.querySelectorAll(".ov-next-stage.done")].map((li) => li.dataset.stage),
      stages: line.querySelectorAll(".ov-next-stage").length,
      height: Math.round(line.getBoundingClientRect().height),
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
    // 1. The reference transaction: the button opens Steps on transaction 1.
    await page.locator("#btn-ov-next").click({ timeout: T });
    await page.waitForSelector("#step-list .run-group.open", { state: "visible", timeout: T });
    walk.landings.pattern = await stepsLanding();
    await page.locator('#step-list .run-group.open [data-act="confirm-run"]').click({ timeout: T });
    await page.waitForFunction(() => /Confirmed/.test(((document.querySelector("#step-list .run-group.open .run-status")
      || {}).textContent) || ""), null, { timeout: T });
    await goOverview();
    walk.afterPattern = await lineState();
    // 2. The other runs (AD-28): each click opens the first run not opened
    // yet; opening it is its review (no Confirm run on runs 2 to 4).
    walk.landings.review = [];
    for (let i = 0; i < 3; i++) {
      const before = await lineState();
      if (!before || before.next !== "review") break;
      await page.locator("#btn-ov-next").click({ timeout: T });
      await page.waitForSelector("#step-list .run-group.open", { state: "visible", timeout: T });
      const landed = Object.assign(await stepsLanding(), { button: before.button, say: before.say,
        confirm: await page.$$eval('#step-list .run-group.open [data-act="confirm-run"]', (b) => b.length) });
      walk.landings.review.push(landed);
      await goOverview();
    }
    walk.afterReview = await lineState();
    for (let k = 0; k < 40 && (readAnno().opened_runs || []).length < 3; k++) await wait(125);   // the save is asynchronous
    walk.opened = readAnno().opened_runs || [];
    // 3. The document: the button opens it on its first empty field, with
    // the cursor in it.
    await page.locator("#btn-ov-next").click({ timeout: T });
    await page.waitForFunction(() => {
      const d = document.getElementById("ov-doc");
      return !!(d && d.open && document.activeElement && document.activeElement.dataset.doc);
    }, null, { timeout: T });
    walk.landings.document = await page.evaluate(() => ({
      open: document.getElementById("ov-doc").open,
      focused: document.activeElement.dataset.doc,
      status: (document.getElementById("ov-doc-status") || {}).textContent,
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
    }));
  } catch (e) {
    logActionError("(d) path walk", e);
    walk.err = String(e.message).split("\n")[0];
  }
  const L = walk.landings;
  record("(d1) 'Confirm transaction 1 in Steps' lands on Steps with the reference transaction open and its first step selected",
    !!(L.pattern && L.pattern.onSteps && L.pattern.openRuns === 1 && L.pattern.openTitle === "Transaction 1" &&
      L.pattern.openIsPattern && L.pattern.selectedInOpenRun),
    JSON.stringify({ landing: L.pattern, err: walk.err }));
  record("(d2) a confirmed reference transaction is ticked; the next act is the first transaction still drafted",
    !!(walk.afterPattern && walk.afterPattern.next === "review" && walk.afterPattern.done.includes("pattern") &&
      walk.afterPattern.button === "Review transaction 2 in Steps"),
    JSON.stringify(walk.afterPattern));
  const reviewOk = Array.isArray(L.review) && L.review.length === 3 && L.review.every((l, i) =>
    l.onSteps && l.openRuns === 1 && l.openTitle === "Transaction " + (i + 2) && !l.openIsPattern &&
    l.selectedInOpenRun && l.button === "Review transaction " + (i + 2) + " in Steps" && l.confirm === 0) &&
    L.review[0].say === "2 transactions differ from the reference transaction.";
  record("(d3) AD-28: 'Review transaction N in Steps' lands on Steps with that transaction open (no Confirm transaction there), for transactions 2 to 4; the line says how many differ; once each was opened the review is ticked (annotations.opened_runs)",
    !!(reviewOk && walk.afterReview && walk.afterReview.next === "document" && walk.afterReview.done.includes("review") &&
      walk.opened.length === 3),
    JSON.stringify({ review: L.review, after: walk.afterReview, opened: walk.opened }));
  record("(d4) 'Write the document' opens the collapsed document with the cursor in its first empty field ('Document · 0 of 9 written')",
    !!(L.document && L.document.open && L.document.focused === "title" && L.document.status === "0 of 9 written" &&
      walk.afterReview && walk.afterReview.button === "Write the document"),
    JSON.stringify(L.document));

  // 4. A document field saves through the one write path, undoably; then the
  // nine fields, trigger, result and improvement among them.
  const PURPOSE = "E2E purpose: settle the monthly supplier invoices";
  const values = {
    title: "E2E order intake", purpose: PURPOSE, scope: "From the order e-mail to the order confirmation",
    trigger: "An order e-mail arrives in the shared mailbox", result: "A sales order in SAP and a confirmation to the customer",
    contacts: "Process owner: E2E Owner", business_rules: "Orders above the credit limit need a check",
    exceptions: "A blocked customer stops the run", improvement: "Automate the customer lookup and the SAP entry",
  };
  const docProbe = {};
  try {
    const purpose = page.locator('#ov-doc [data-doc="purpose"]');
    await purpose.fill(PURPOSE, { timeout: T });
    await purpose.press("Tab");                          // change fires on leaving the field
    // AD-29: the count names the fields still to write.
    await page.waitForFunction(() => (document.getElementById("ov-doc-status") || {}).textContent ===
      "1 of 9 written. To write: Title, Scope, Trigger, Result, Key contacts, Business rules, Exceptions, " +
      "Improvement and automation scope", null, { timeout: T });
    docProbe.saved = (readAnno().document || {}).purpose;
    // Undo: Ctrl+Z outside a field is the app's undo.
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => {
      const t = document.querySelector('#ov-doc [data-doc="purpose"]');
      return !!(t && t.value === "");
    }, null, { timeout: T });
    docProbe.afterUndoOnDisk = (readAnno().document || {}).purpose || "";
    docProbe.panelStayedOpen = await page.evaluate(() => document.getElementById("ov-doc").open);
    for (const [k, v] of Object.entries(values)) {
      const el = page.locator('#ov-doc [data-doc="' + k + '"]');
      await el.fill(v, { timeout: T });
      await el.press("Tab");
    }
    await page.waitForFunction(() => (document.getElementById("ov-doc-status") || {}).textContent === "9 of 9 written",
      null, { timeout: T });
    docProbe.onDisk = readAnno().document || {};
    docProbe.line = await lineState();
    docProbe.summaryName = await page.evaluate(() =>
      ((document.querySelector("#ov-summary .ov-summary-name") || {}).textContent || "").trim());
    // Lane FX3 (validation pass 3, F23): the capture's request shows on the
    // project line (here its code alone, demo-order-processing), not only in
    // its tooltip, now that the document title names the project.
    docProbe.request = await page.evaluate(() =>
      ((document.querySelector('#ov-summary [data-summary="request"]') || {}).textContent || "").trim());
    // The Recents entry is named by the document title once it is written.
    await page.locator("#btn-recent-menu").click({ timeout: T });
    docProbe.recent = await page.evaluate(() => ({
      heading: ((document.querySelector("#recent-menu-content .recent-menu-heading") || {}).textContent || "").trim(),
      first: ((document.querySelector("#recent-menu-content .recent-menu-item .ri-label") || {}).textContent || "").trim(),
    }));
    await page.locator("#btn-recent-menu").click({ timeout: T });
  } catch (e) {
    logActionError("(d5) document fields", e);
    docProbe.err = String(e.message).split("\n")[0];
  }
  record("(d5) a document field saves to annotations.document (contract C6), and Ctrl+Z takes it back",
    !!(!docProbe.err && docProbe.saved === PURPOSE && docProbe.afterUndoOnDisk === "" && docProbe.panelStayedOpen),
    JSON.stringify({ saved: docProbe.saved, afterUndoOnDisk: docProbe.afterUndoOnDisk,
      panelStayedOpen: docProbe.panelStayedOpen, err: docProbe.err }));
  record("(d6) the nine fields save to annotations.json, Trigger, Result and Improvement and automation scope under the keys trigger, result and improvement",
    !!(docProbe.onDisk && Object.entries(values).every(([k, v]) => docProbe.onDisk[k] === v) &&
      docProbe.onDisk.notes === "" && docProbe.onDisk.trigger === values.trigger &&
      docProbe.onDisk.result === values.result && docProbe.onDisk.improvement === values.improvement),
    JSON.stringify({ onDisk: docProbe.onDisk }));
  record("(d6) with the document written, the Checklist shrinks to one short line: no act list, the next act Export PDD (AD-28: no As-Is stage)",
    !!(docProbe.line && docProbe.line.next === "export" && docProbe.line.ready && docProbe.line.stages === 0 &&
      docProbe.line.label === "Checklist" && docProbe.line.readyText === "Everything before the export is done: the PDD is ready to export." &&
      docProbe.line.button === "Export PDD" && docProbe.line.height > 0 && docProbe.line.height < 60),
    JSON.stringify({ line: docProbe.line }));
  record("(P3.9) once written, the document title names the project on the project line and in Recent projects",
    docProbe.summaryName === "E2E order intake" && !!docProbe.recent &&
      docProbe.recent.heading === "Recent projects" && docProbe.recent.first === "E2E order intake",
    JSON.stringify({ summaryName: docProbe.summaryName, recent: docProbe.recent }));
  record("lane FX3: the capture's request shows on the project line beside the title that names the project (Request: its code), not only in the tooltip",
    docProbe.request === "Request: demo-order-processing", JSON.stringify({ request: docProbe.request }));

  // The export renders the maps chosen for the PDD off screen and hands the
  // pipeline an image; record both, so the embed is pinned too (AD-28).
  await page.evaluate(() => {
    const RefmapUI = require("./refmap-ui.js");
    const orig = RefmapUI.renderPddMaps;
    RefmapUI.renderPddMaps = async () => {
      const out = await orig();
      window.__pddMaps = { asis: !!(out && out.asis), tobe: !!(out && out.tobe) };
      return out;
    };
    const Ipc = require("./ipc.js");
    const run = Ipc.runNormalizeExtended;
    Ipc.runNormalizeExtended = (opts) => {
      if (opts && opts.pddOut) {
        const fs = require("fs");
        const size = (p) => { try { return p ? fs.statSync(p).size : 0; } catch (_) { return -1; } };
        window.__pddOpts = { map: size(opts.pddMapImage), tobe: size(opts.pddTobeImage),
          level: require("./state.js").getLevel() };
      }
      return run(opts);
    };
    // The map from the runs is process_map_step.bpmn drawn by bpmn-js off
    // screen (renderer.js), never the live map on the Map level.
    const render = RefmapUI.renderBpmnToPng;
    RefmapUI.renderBpmnToPng = async (xml) => {
      const fs = require("fs"), path = require("path");
      const s = require("./state.js").getSession();
      let stepBpmn = false;
      try { stepBpmn = xml === fs.readFileSync(path.join(s.sessionFolder, "process_map_step.bpmn"), "utf-8"); } catch (_) {}
      (window.__bpmnRenders = window.__bpmnRenders || []).push({ stepBpmn, level: require("./state.js").getLevel() });
      return render(xml);
    };
  }).catch((e) => console.log("spy", e.message));

  /* Export PDD from the Checklist: the Session menu's PDD path. The save
     dialog is stubbed to a temp path, the shell reveal to a no-op. */
  const exportPdd = async (tag) => {
    const out = path.join(os.tmpdir(), "pdt-ov-e2e-" + tag + "-" + Date.now() + ".docx");
    await app.evaluate(({ dialog, shell }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      shell.showItemInFolder = () => {};
    }, out).catch((e) => console.log("stub dialog", e.message));
    await page.evaluate(() => { window.__pddMaps = null; window.__pddOpts = null; window.__bpmnRenders = []; });
    await goOverview();
    await page.click("#btn-ov-next").catch((e) => console.log("export click", e.message));
    let buf = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (fs.existsSync(out)) {
        const b = fs.readFileSync(out);
        if (b.length > 1000 && b[0] === 0x50 && b[1] === 0x4b) { buf = b; break; }
      }
      await wait(500);
    }
    await page.waitForFunction(() => {
      const el = document.getElementById("session-layout-overview");
      return el && getComputedStyle(el).display !== "none";
    }, null, { timeout: 30000 }).catch(() => {});
    const r = { bytes: buf ? buf.length : 0, xml: null, media: [] };
    if (buf) {
      try { r.xml = readZipEntry(buf, "word/document.xml"); r.media = zipNames(buf).filter((n) => n.startsWith("word/media/")); }
      catch (e) { r.zipErr = e.message; }
    }
    r.handed = await page.evaluate(() => ({ maps: window.__pddMaps || null, opts: window.__pddOpts || null,
      renders: window.__bpmnRenders || null })).catch(() => null);
    r.status = await page.evaluate(() => ({ text: ((document.getElementById("session-pills") || {}).textContent || "").trim(),
      log: getComputedStyle(document.getElementById("log-host")).display })).catch(() => null);
    try { fs.unlinkSync(out); } catch (_) {}
    return r;
  };

  // 5. The last act with no As-Is copy: the PDD's map is the map from the runs.
  const levelProbe = () => {
    const shown = ["overview", "flow", "steps", "map"].filter((l) => {
      const el = document.getElementById("session-layout-" + l);
      return el && getComputedStyle(el).display !== "none";
    });
    const lit = [...document.querySelectorAll(".view-mode-btn.active")].map((b) => b.dataset.level);
    return { shown, lit, level: require("./state.js").getLevel() };
  };
  const first = await exportPdd("runs-map");
  const after = await page.evaluate(levelProbe).catch((e) => ({ err: e.message }));
  const backInSync = !!(after && !after.err && after.level === "overview" &&
    JSON.stringify(after.shown) === '["overview"]' && JSON.stringify(after.lit) === '["overview"]');
  record("(d8) 'Export PDD' writes a .docx through the Session menu's PDD path, then returns to the Overview with the level bar in sync; no status line or log left",
    first.bytes > 1000 && backInSync && first.status && first.status.text === "" && first.status.log === "none",
    "bytes=" + first.bytes + " after=" + JSON.stringify(after) + " status=" + JSON.stringify(first.status));
  if (!(first.bytes > 1000 && backInSync)) await shot(page, "fail-overview-pdd.png");
  record("AD-28: with no As-Is copy the export hands the PDD the map from the runs: process_map_step.bpmn drawn off screen by bpmn-js (not the live map; the Map level was never opened), no To-Be",
    !!(first.handed && first.handed.opts && first.handed.opts.map > 1000 && first.handed.opts.tobe === 0 &&
      first.handed.opts.level === "overview" && first.handed.maps && first.handed.maps.asis === false &&
      Array.isArray(first.handed.renders) && first.handed.renders.length === 1 && first.handed.renders[0].stepBpmn &&
      first.handed.renders[0].level === "overview" && first.media.length >= 1),
    JSON.stringify({ handed: first.handed, media: first.media.length }));
  const docChecks = {
    purpose: !!(first.xml && first.xml.includes(PURPOSE)),
    title: !!(first.xml && first.xml.includes("E2E order intake")),
    purposePlaceholderGone: !!(first.xml && !first.xml.includes("the business need this process serves")),
    keptAfterExport: (readAnno().document || {}).purpose === PURPOSE,
  };
  record("(d9) contract C6 end to end: the exported PDD (word/document.xml) carries the Purpose written on the Overview, in place of its placeholder",
    !!(docChecks.purpose && docChecks.title && docChecks.purposePlaceholderGone && docChecks.keptAfterExport),
    JSON.stringify(Object.assign({ xmlBytes: first.xml ? first.xml.length : 0 }, docChecks)));

  // Lane CC, one source: the Overview's Data and Applications and time, read
  // after the export (the export's analysis wrote them), are the document's
  // own tables of sections 5 and 6, cell by cell, and its Re-keyed data lines.
  const ovAfter = await page.evaluate(async () => {
    const host = document.getElementById("ov-observations");
    const items = [...host.querySelectorAll(".analysis-module[data-module]")];
    for (const m of items) if (!m.open) m.querySelector("summary").click();
    await new Promise((r) => setTimeout(r, 100));
    const tables = [...host.querySelectorAll("table.ov-rows")].map((t) =>
      [...t.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent)));
    const rekeyed = [...host.querySelectorAll(".ov-rekeyed li")].map((li) => li.textContent);
    for (const m of items) m.querySelector("summary").click();
    try { for (const k of ["data", "time"]) localStorage.removeItem("pdt.analysis." + k); } catch (_) {}
    return { tables, rekeyed };
  }).catch((e) => ({ err: e.message }));
  const docTables = docxTables(first.xml);
  const printed = (ovAfter.tables || []).map((ot) => docTables.find((dt) => same(dt[0], ot[0])) || null);
  record("(d9b) one source: the Overview's three tables (Data, Time per transaction, Time in each application) are the exported PDD's tables of sections 5 and 6 cell by cell, and its Re-keyed data sentences are in the PDD",
    !!(!ovAfter.err && ovAfter.tables.length === 3 && printed.every((t, i) => t && same(t, ovAfter.tables[i])) &&
      ovAfter.rekeyed.length === 2 && ovAfter.rekeyed.every((line) => first.xml && first.xml.includes(line))),
    JSON.stringify({ overview: (ovAfter.tables || []).map((t) => t.length), inPdd: printed.map((t) => (t ? t.length : null)),
      rekeyed: ovAfter.rekeyed, err: ovAfter.err }));

  // 6. The As-Is map is the Map's own act (no stage): an edited As-Is copy
  // and a To-Be copy, then the export hands both.
  const mapProbe = {};
  try {
    await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
    await page.waitForSelector("#session-layout-map", { state: "visible", timeout: T });
    await page.locator("#btn-fork-refmap").click({ timeout: T });
    await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
    await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: T });
    mapProbe.role = await page.locator("#refmap-editor-pdd").inputValue({ timeout: T });
    // Lane MV: a new copy is kept at its first change (the legend moved a
    // little), after the editor's delayed write.
    await page.evaluate(() => {
      const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
      ed.get("modeling").moveElements([ed.get("elementRegistry").get("TextAnnotation_legend")], { x: 0, y: 8 });
    });
    await wait(1400);
    await page.locator("#btn-refmap-editor-close").click({ timeout: T });
    await page.locator('#refmap-list [data-rm-act="dup"]').first().click({ timeout: T });
    await page.waitForFunction(() => document.querySelectorAll("#refmap-list .refmap-row").length === 2, null, { timeout: T });
    await page.locator("#refmap-list .refmap-row").nth(1).locator("[data-rm-pdd]").selectOption("to_be", { timeout: T });
    await wait(500);
    mapProbe.roles = (readAnno().reference_maps || []).map((m) => m && m.pdd_role);
    await goOverview();
    mapProbe.line = await lineState();
  } catch (e) {
    logActionError("(d7) As-Is map", e);
    mapProbe.err = String(e.message).split("\n")[0];
  }
  record("(d7) Edit as the As-Is map, with a change, makes the PDD's As-Is copy (the Map's act; lane MV: kept at its first change); the What is left line does not change (no As-Is stage)",
    !!(!mapProbe.err && mapProbe.role === "as_is" && JSON.stringify(mapProbe.roles) === '["as_is","to_be"]' &&
      mapProbe.line && mapProbe.line.ready && mapProbe.line.next === "export" && mapProbe.line.button === "Export PDD"),
    JSON.stringify(mapProbe));
  const second = await exportPdd("as-is");
  // (What the PDD prints around the images is the PDD lane's: only the
  // images handed over are pinned here.)
  record("(d10) with an As-Is and a To-Be copy chosen, the export hands the PDD both images (the As-Is copy in place of the map from the runs)",
    !!(second.bytes > 1000 && second.handed && second.handed.maps && second.handed.maps.asis && second.handed.maps.tobe &&
      second.handed.opts && second.handed.opts.map > 1000 && second.handed.opts.tobe > 1000 && second.media.length >= 1 &&
      Array.isArray(second.handed.renders) && second.handed.renders.length === 0),
    JSON.stringify({ handed: second.handed, media: [first.media.length, second.media.length] }));
  record("(d11) the exported PDD embeds the As-Is and To-Be pictures with their alternative text, the To-Be under its own heading (lane LUX-P)",
    !!(second.xml && second.xml.includes('descr="As-Is process map"') &&
      second.xml.includes('descr="To-Be process map"') && second.xml.includes("7.1 To-Be process map")),
    JSON.stringify({ xmlBytes: second.xml ? second.xml.length : 0 }));

  // P2.12: with an As-Is copy chosen for the PDD, the Export menu's map items
  // save that copy (the map the analyst finished), not the process map.
  const exportVia = async (itemId, outPath) => {
    await app.evaluate(({ dialog, shell }, p) => {
      global.__pdtSaveDefault = null;
      global.__pdtRevealed = null;
      dialog.showSaveDialog = async (_w, opts) => {
        global.__pdtSaveDefault = (opts && opts.defaultPath) || null;
        return { canceled: false, filePath: p };
      };
      // AD-29: every export opens its folder at the file; record where.
      shell.showItemInFolder = (f) => { global.__pdtRevealed = f; };
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
    const revealed = await app.evaluate(() => global.__pdtRevealed).catch(() => null);
    try { fs.unlinkSync(outPath); } catch (_) {}
    return { text, suggested: suggested ? path.basename(suggested) : null,
      revealed: !!revealed && path.resolve(revealed).toLowerCase() === path.resolve(outPath).toLowerCase() };
  };
  const mapExport = {};
  try {
    const asIsEntry = (readAnno().reference_maps || []).find((m) => m && m.pdd_role === "as_is");
    mapExport.asIsFile = asIsEntry ? asIsEntry.file : null;
    const asIsXml = asIsEntry ? fs.readFileSync(path.join(SESSION_MARKED, asIsEntry.file), "utf-8") : null;
    const bpmn = await exportVia("btn-session-step-bpmn", path.join(os.tmpdir(), "pdt-ov-e2e-asis-" + Date.now() + ".bpmn"));
    mapExport.bpmnIsTheCopy = !!(asIsXml && bpmn.text === asIsXml);
    mapExport.bpmnSuggested = bpmn.suggested;
    mapExport.bpmnRevealed = bpmn.revealed;
    const svg = await exportVia("btn-session-map-svg", path.join(os.tmpdir(), "pdt-ov-e2e-asis-" + Date.now() + ".svg"));
    mapExport.svgSuggested = svg.suggested;
    mapExport.svgRevealed = svg.revealed;
    mapExport.svgIsBpmnDrawing = /<svg[\s>]/.test(svg.text) && /djs-/.test(svg.text) && !/Flow diagram \(DFG\)/.test(svg.text);
    mapExport.labels = await page.evaluate(() => ["btn-session-map-svg", "btn-session-step-bpmn"]
      .map((id) => ((document.getElementById(id) || {}).textContent || "").trim()));
    // Lane FX3: offered under the project's name (the document title here).
    mapExport.base = await page.evaluate(() => {
      const s = require("./state.js").getSession();
      return require("./session-summary.js").exportBaseName(s, require("path").basename(s.sessionFolder));
    });
  } catch (e) {
    logActionError("P2.12 map exports", e);
    mapExport.err = String(e.message).split("\n")[0];
  }
  record("P2.12 + AD-29: with an As-Is copy chosen, Export > Process map (BPMN) saves that copy and Process map (image) draws it; each opens its folder at the file",
    !!(!mapExport.err && mapExport.asIsFile && mapExport.bpmnIsTheCopy && mapExport.base === "E2E order intake" &&
      mapExport.bpmnSuggested === "E2E order intake As-Is map.bpmn" &&
      mapExport.svgIsBpmnDrawing && mapExport.svgSuggested === "E2E order intake As-Is map.svg" &&
      mapExport.bpmnRevealed && mapExport.svgRevealed &&
      JSON.stringify(mapExport.labels) === '["Process map (image)","Process map (BPMN)"]'),
    JSON.stringify(mapExport));

  // (h) Attach video: choose the file, then two clicks (a moment in the
  // video, the same moment on the timeline), never a typed offset. Nothing is
  // written before the second click; Cancel leaves the recording as it was.
  const VIDEO = path.join(SESSION_MARKED, "call-recording.webm");
  fs.writeFileSync(VIDEO, Buffer.alloc(64));
  const SYNC_AT = "2026-05-14T09:00:30Z";
  const attach = {};
  const noExternal = () => !readAnno().external_video;
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, VIDEO);
    // First Cancel: nothing written, the video band back.
    await goOverview();
    await page.locator("#ov-summary #btn-attach-video").click({ timeout: T });
    await page.waitForSelector("#video-sync-card", { state: "visible", timeout: T });
    attach.cancelPhase = await page.evaluate(() => ({
      onTimeline: require("./state.js").getLevel() === "flow",
      card: ((document.getElementById("video-sync-card") || {}).textContent || "").trim(),
      prompt: document.querySelectorAll(".modal-prompt").length,
      videoShown: getComputedStyle(document.getElementById("video")).display !== "none",
    }));
    attach.cancelPhase.nothingYet = noExternal();
    await page.locator("#video-sync-card .vs-cancel").click({ timeout: T });
    attach.afterCancel = await page.evaluate(() => ({
      card: !!document.getElementById("video-sync-card"),
      band: document.getElementById("video-pane").classList.contains("no-recording"),
      noVideo: getComputedStyle(document.getElementById("no-video")).display !== "none",
    }));
    attach.afterCancel.nothingWritten = noExternal();
    // Then the real one.
    await goOverview();
    await page.locator("#ov-summary #btn-attach-video").click({ timeout: T });
    await page.waitForSelector("#video-sync-card .vs-mark", { state: "visible", timeout: T });
    await page.locator("#video-sync-card .vs-mark").click({ timeout: T });
    attach.step2 = ((await page.locator("#video-sync-card").textContent({ timeout: T })) || "").trim();
    attach.stillNothing = noExternal();
    await page.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
    const at = await page.evaluate((iso) => {
      const tl = document.getElementById("timeline");
      const evs = require("./state.js").getSession().events;
      const f = Date.parse(evs[0].timestamp), l = Date.parse(evs[evs.length - 1].timestamp);
      const r = tl.getBoundingClientRect();
      return { x: r.left + ((Date.parse(iso) - f) / (l - f)) * r.width, y: r.top + 60, inView: r.top + 60 < innerHeight };
    }, SYNC_AT);
    attach.at = at;
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => /Video attached and synced/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: T });
    const ev = readAnno().external_video || null;
    attach.saved = ev ? { path: ev.path, offset: ev.offset_ms } : null;
    attach.wantOffset = Date.parse(SYNC_AT) - Date.parse(JSON.parse(fs.readFileSync(path.join(SESSION_MARKED, "manifest.json"), "utf-8")).started_at);
    attach.after = await page.evaluate(() => ({
      line: ((document.querySelector('#ov-summary [data-summary="video"]') || {}).textContent || "").trim(),
      button: ((document.getElementById("btn-attach-video") || {}).textContent || "").trim(),
      sync: getComputedStyle(document.getElementById("btn-sync-video")).display !== "none",
    }));
  } catch (e) {
    logActionError("(h) attach video", e);
    attach.err = String(e.message).split("\n")[0];
  }
  const cp = attach.cancelPhase || {}, ac = attach.afterCancel || {};
  record("(h) Attach video opens the Timeline with the chosen video and the two-click sync card, never a typed offset; Cancel writes nothing and brings the no-video band back",
    !!(!attach.err && cp.onTimeline && /^Step 1 of 2: pause the video at a recognizable moment, then click Mark frame\./.test(cp.card) &&
      cp.prompt === 0 && cp.videoShown && cp.nothingYet && !ac.card && ac.band && ac.noVideo && ac.nothingWritten),
    JSON.stringify({ cancelPhase: cp, afterCancel: ac, err: attach.err }));
  record("(h) Mark frame, then a click on the timeline, attaches the video with the offset of that moment (stored relative to the folder it sits in, V2 item 5); the recording line then says Video with Replace and the video header offers Sync video",
    !!(!attach.err && /^Step 2 of 2: click the matching moment on the timeline/.test(attach.step2 || "") && attach.stillNothing &&
      attach.saved && attach.saved.path === path.basename(VIDEO) && Math.abs(attach.saved.offset - attach.wantOffset) <= 3000 &&
      attach.after && attach.after.line === "Video" && attach.after.button === "Replace" && attach.after.sync),
    JSON.stringify({ step2: attach.step2, saved: attach.saved, wantOffset: attach.wantOffset, at: attach.at, after: attach.after }));

  // (h2) Lane CC: Replace and Remove video, each with its Undo. A video from
  // outside the folder is copied into video/; Replace takes out the copy it
  // replaces, Remove takes out the entry and the copy; Ctrl+Z brings back
  // the entry and the file each time.
  const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-e2e-videos-"));
  const V1 = path.join(OUTSIDE, "first call.webm"), V2 = path.join(OUTSIDE, "second call.webm");
  fs.writeFileSync(V1, Buffer.alloc(96, 1));
  fs.writeFileSync(V2, Buffer.alloc(128, 2));
  const inVideo = (name) => fs.existsSync(path.join(SESSION_MARKED, "video", name));
  const storedPath = () => ((readAnno().external_video || {}).path || null);
  const replaceWith = async (file) => {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, file);
    await goOverview();
    await page.locator("#ov-summary #btn-attach-video").click({ timeout: T });
    await page.waitForSelector("#video-sync-card .vs-mark", { state: "visible", timeout: T });
    await page.locator("#video-sync-card .vs-mark").click({ timeout: T });
    await page.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
    const box = await page.locator("#timeline").boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + 60);
    await page.waitForFunction(() => /Video replaced/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    await page.waitForFunction((name) => {
      const s = require("./state.js").getSession();
      return !!(s && s.recordingPath && s.recordingPath.split(String.fromCharCode(92)).join("/").endsWith("/video/" + name));
    }, path.basename(file), { timeout: T });
  };
  const undo = async (want) => {
    await page.evaluate(async () => { await require("./session.js").performUndo(); });
    await page.waitForFunction((w) => {
      const s = require("./state.js").getSession();
      const p = s && s.annotations && s.annotations.external_video && s.annotations.external_video.path;
      // The reload after the undo (session.js revertFollowUp) has read the video back.
      return w === null ? !p : (p === w && !!(s.recordingAvailable && s.recordingPath &&
        s.recordingPath.split(String.fromCharCode(92)).join("/").endsWith("/" + w)));
    }, want, { timeout: T });
  };
  const vid = {};
  try {
    await replaceWith(V1);
    vid.first = { stored: storedPath(), copied: inVideo("first call.webm") };
    await replaceWith(V2);
    vid.second = { stored: storedPath(), secondIn: inVideo("second call.webm"), firstGone: !inVideo("first call.webm") };
    await undo("video/first call.webm");
    vid.undoReplace = { stored: storedPath(), firstBack: inVideo("first call.webm"), secondGone: !inVideo("second call.webm") };
    await goOverview();
    vid.line = await page.evaluate(() => [...document.querySelectorAll("#ov-summary .ov-summary-line button")].map((b) => b.id + ":" + b.textContent.trim()));
    vid.header = await page.evaluate(() => {
      const b = document.getElementById("btn-video-remove");
      return { shown: !!b && !b.hidden && getComputedStyle(b).display !== "none", text: b ? b.textContent.trim() : null };
    });
    await page.locator("#ov-summary #btn-remove-video").click({ timeout: T });
    await page.waitForSelector(".modal-confirm", { state: "visible", timeout: T });
    vid.confirm = ((await page.locator(".modal-confirm").textContent({ timeout: T })) || "").replace(/\s+/g, " ").trim();
    await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
    await page.waitForFunction(() => /Video removed/.test((document.getElementById("toast") || {}).textContent || ""), null, { timeout: T });
    vid.removed = { stored: storedPath(), fileGone: !inVideo("first call.webm"),
      line: await page.evaluate(() => ((document.querySelector('#ov-summary [data-summary="video"]') || {}).textContent || "").trim()),
      removeBtn: await page.evaluate(() => !!document.getElementById("btn-remove-video")) };
    await undo("video/first call.webm");
    vid.undoRemove = { stored: storedPath(), fileBack: inVideo("first call.webm") };
    await goOverview();
    vid.lineAfterUndo = await page.evaluate(() => ((document.querySelector('#ov-summary [data-summary="video"]') || {}).textContent || "").trim());
  } catch (e) {
    logActionError("(h2) replace and remove video", e);
    vid.err = String(e.message).split("\n")[0];
    await shot(page, "fail-overview-remove-video.png");
  }
  record("(h2) Replace video copies the new video into video/ and takes out the copy it replaces; Ctrl+Z brings the replaced entry and its file back and takes the new copy out",
    !!(!vid.err && vid.first && vid.first.stored === "video/first call.webm" && vid.first.copied &&
      vid.second.stored === "video/second call.webm" && vid.second.secondIn && vid.second.firstGone &&
      vid.undoReplace.stored === "video/first call.webm" && vid.undoReplace.firstBack && vid.undoReplace.secondGone),
    JSON.stringify({ first: vid.first, second: vid.second, undoReplace: vid.undoReplace, err: vid.err }));
  record("(h2) Remove video (the project line's Remove, and Remove video beside Sync video) asks first, then takes out the entry and its copy in video/; Ctrl+Z brings both back",
    !!(!vid.err && Array.isArray(vid.line) && vid.line.includes("btn-attach-video:Replace") && vid.line.includes("btn-remove-video:Remove") &&
      vid.header && vid.header.shown && vid.header.text === "Remove video" &&
      /Remove the video\?/.test(vid.confirm || "") && /copy in the project's video folder is deleted/.test(vid.confirm || "") &&
      /Ctrl\+Z brings it back/.test(vid.confirm || "") &&
      vid.removed && vid.removed.stored === null && vid.removed.fileGone && vid.removed.line === "No video" && !vid.removed.removeBtn &&
      vid.undoRemove && vid.undoRemove.stored === "video/first call.webm" && vid.undoRemove.fileBack && vid.lineAfterUndo === "Video"),
    JSON.stringify({ line: vid.line, header: vid.header, confirm: vid.confirm, removed: vid.removed, undoRemove: vid.undoRemove, after: vid.lineAfterUndo }));

  // (k) Lane CC: the Observations' rows are as new as the steps. A step
  // renamed in Steps makes them older; as the Overview opens they are
  // measured again (the status line, the previous rows meanwhile under "From
  // the last analysis; refreshing"), then show the new name, and the Overview
  // opened again analyzes nothing. A document field taking the cursor stops a
  // refresh (nothing is analyzed while the analyst types): the rows stay,
  // saying they are older, the text typed is saved, and the next opening
  // measures them.
  const NAME1 = "E2E renamed: Look up the customer account";
  const NAME2 = "E2E renamed: Find the customer";
  const idle = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
  const rowsNow = (name) => page.evaluate((n) => {
    const line = document.getElementById("ov-rows-freshness");
    const s = require("./state.js").getSession();
    return {
      busy: require("./views/flow-view.js").analysisBusy(),
      line: line && !line.hidden ? line.textContent : "",
      hasName: [...document.querySelectorAll("#ov-observations table.ov-rows td")].some((td) => td.textContent.includes(n)),
      current: require("./rows-freshness.js").stepsSignature(s.annotations) === s.analysis.steps_signature,
    };
  }, name);
  const renameFirst = async (name) => {
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    await page.waitForSelector("#step-list .run-group.pattern", { state: "visible", timeout: T });
    const open = await page.evaluate(() => document.querySelector("#step-list .run-group.pattern").classList.contains("open"));
    if (!open) await page.locator("#step-list .run-group.pattern > .run-row").click({ timeout: T });
    await page.locator("#step-list .run-group.pattern .step-row").first().click({ timeout: T });
    await page.locator("#step-name").fill(name, { timeout: T });
    await page.locator("#step-name").press("Enter");   // no Save button: Enter saves the name
    await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")]
      .some((e) => e.textContent.trim() === n), name, { timeout: T });
  };
  const openOverview = () => page.evaluate(() => { document.querySelector('.view-mode-btn[data-level="overview"]').click(); });
  const fr = {};
  try {
    await idle();
    await renameFirst(NAME1);
    await openOverview();
    fr.opened = await rowsNow(NAME1);
    fr.pills = await page.evaluate(() => (document.getElementById("session-pills").textContent || "").replace(/\s+/g, " ").trim());
    await idle();
    await page.waitForFunction((n) => [...document.querySelectorAll("#ov-observations table.ov-rows td")]
      .some((td) => td.textContent.includes(n)), NAME1, { timeout: T });
    fr.after = await rowsNow(NAME1);
    fr.recorded = JSON.parse(fs.readFileSync(path.join(SESSION_MARKED, "analysis.json"), "utf-8")).steps_signature ===
      await page.evaluate(() => require("./rows-freshness.js").stepsSignature(require("./state.js").getSession().annotations));
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    await openOverview();
    fr.again = await rowsNow(NAME1);
    // Typing stops the refresh.
    await renameFirst(NAME2);
    await openOverview();
    await page.waitForFunction(() => { const r = require("./state.js").getAnalysisRun(); return !!(r && r.status === "running"); },
      null, { timeout: T });
    await page.evaluate(() => {
      const d = document.getElementById("ov-doc");
      d.open = true;
      d.querySelector('[data-doc="notes"]').focus();
    });
    await idle();
    fr.stopped = await rowsNow(NAME2);
    await page.keyboard.type("E2E: typed while the rows were older");
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => (((require("./state.js").getSession().annotations || {}).document || {}).notes || "")
      .startsWith("E2E: typed"), null, { timeout: T });
    for (let k = 0; k < 40 && !((readAnno().document || {}).notes || "").startsWith("E2E: typed"); k++) await wait(125);
    fr.typed = (readAnno().document || {}).notes || "";
    fr.toast = await page.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
    // The next opening measures them.
    await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    await openOverview();
    fr.reopened = await rowsNow(NAME2);
    await idle();
    await page.waitForFunction((n) => [...document.querySelectorAll("#ov-observations table.ov-rows td")]
      .some((td) => td.textContent.includes(n)), NAME2, { timeout: T });
    fr.final = await rowsNow(NAME2);
  } catch (e) {
    logActionError("(k) the rows refresh as the Overview opens", e);
    fr.err = String(e.message).split("\n")[0];
    await shot(page, "fail-overview-rows-refresh.png");
  }
  record("(k) lane CC: a step renamed in Steps: as the Overview opens its rows are measured again (the status line; the previous rows meanwhile, \"From the last analysis; refreshing\"), then show the new name; opened again, nothing is analyzed",
    !!(!fr.err && fr.opened && fr.opened.busy && fr.opened.line === "From the last analysis; refreshing" && !fr.opened.hasName &&
      /Updating steps and map/.test(fr.pills || "") &&
      fr.after.hasName && fr.after.line === "" && fr.after.current && fr.recorded &&
      fr.again && !fr.again.busy && fr.again.line === "" && fr.again.hasName),
    JSON.stringify({ opened: fr.opened, pills: fr.pills, after: fr.after, recorded: fr.recorded, again: fr.again, err: fr.err }));
  record("(k) lane CC: a document field taking the cursor stops the refresh (no analysis while the analyst types): the rows stay, \"From the last analysis; the steps changed since.\", the text typed is saved; the next opening measures them",
    !!(!fr.err && fr.stopped && !fr.stopped.busy && !fr.stopped.hasName &&
      fr.stopped.line === "From the last analysis; the steps changed since." &&
      fr.typed === "E2E: typed while the rows were older" && !/not saved|cancelled/i.test(fr.toast || "") &&
      fr.reopened && fr.reopened.busy && fr.final && fr.final.hasName && fr.final.line === "" && fr.final.current),
    JSON.stringify({ stopped: fr.stopped, typed: fr.typed, toast: fr.toast, reopened: fr.reopened, final: fr.final, err: fr.err }));

  await close();

  // ================= Launch 2: the marker-stripped copy (no runs marked) ==
  let page2, close2;
  try {
    ({ page: page2, close: close2 } = await launch(SESSION_STRIPPED, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (stripped):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  // (e) AD-14: with no transactions the Checklist's next act is marking
  // them, with the one-line instruction and the button.
  const markRuns = await page2.evaluate(() => {
    const line = document.getElementById("ov-next");
    return {
      next: line ? line.dataset.next : null,
      lineText: line ? (line.textContent || "").trim() : null,
      button: ((document.getElementById("btn-ov-next") || {}).textContent || "").trim(),
      badges: document.querySelectorAll("#overview-content .ov-badge, #ov-mark-runs").length,
    };
  }).catch((e) => ({ err: e.message }));
  record("(e) marker-stripped session: the Checklist says no transactions are marked, with the instruction and 'Mark the transactions on the Timeline'",
    !!(markRuns && !markRuns.err && markRuns.next === "runs" && /no transactions marked/i.test(markRuns.lineText || "") &&
      /Start a transaction here/.test(markRuns.lineText || "") && /Apply marker changes/.test(markRuns.lineText || "") &&
      markRuns.button === "Mark the transactions on the Timeline" && markRuns.badges === 0),
    JSON.stringify(markRuns));
  if (!(markRuns && markRuns.next === "runs")) await shot(page2, "fail-overview-mark-runs.png");

  await shot(page2, "overview-unsegmented-state.png");

  // (e2) The button LANDS: the Timeline shows, with the Markers panel.
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
  record("(e2) 'Mark the transactions on the Timeline' lands on the Timeline with the Markers panel showing on screen",
    !!(landed && !landed.err && markersTabBefore === false && landed.flowVisible &&
      landed.markersTabActive && landed.markersPanelVisible && landed.panelOnScreen),
    JSON.stringify({ markersTabBefore, landed }));
  if (!(landed && landed.markersPanelVisible)) await shot(page2, "fail-overview-mark-runs-land.png");

  await close2();

  // ================= Launch 3: a copy never analyzed (AD-22) ===============
  const RAW_ANNO = path.join(SESSION_RAW, "annotations.json");
  const RAW_STATS = path.join(SESSION_RAW, "stats.json");
  const readRaw = () => JSON.parse(fs.readFileSync(RAW_ANNO, "utf-8"));
  let app3, page3, close3;
  try {
    ({ app: app3, page: page3, close: close3 } = await launch(SESSION_RAW, pageErrors, false));
  } catch (e) {
    console.error("FATAL: could not launch viewer (not analyzed):", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const statusNow = (pg) => pg.evaluate(() => ({
    status: ((document.getElementById("session-pills") || {}).textContent || "").replace(/\s+/g, " ").trim(),
    line: ((document.getElementById("run-status") || {}).textContent || "").trim(),
    cancelText: ((document.getElementById("btn-cancel-normalize") || {}).textContent || "").trim(),
    cancel: !!document.getElementById("btn-cancel-normalize"),
    log: getComputedStyle(document.getElementById("log-host")).display,
    failure: ((document.getElementById("log-failure") || {}).textContent || "").trim(),
  }));
  // (g1) On open: no button to press; the analysis runs by itself with one
  // status line, the page readable, no log.
  const g = {};
  try {
    g.running = await page3.waitForFunction(() => {
      const s = document.getElementById("session-pills");
      return !!s && /^Updating steps and map\.\.\./.test((s.textContent || "").trim());
    }, null, { timeout: T }).then(() => true, () => false);
    g.during = Object.assign(await statusNow(page3), await page3.evaluate(() => ({
      note: ((document.getElementById("ov-waiting") || {}).textContent || "").trim(),
      analyze: document.querySelectorAll("#btn-normalize").length,
      overviewShown: getComputedStyle(document.getElementById("session-layout-overview")).display !== "none",
    })));
    await page3.waitForFunction(() => /Steps and map updated/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: 180000 });
    await page3.waitForSelector("#ov-next", { state: "visible", timeout: T });
    g.after = await statusNow(page3);
    g.files = { stats: fs.existsSync(RAW_STATS), analysis: fs.existsSync(path.join(SESSION_RAW, "analysis.json")),
      bpmn: fs.existsSync(path.join(SESSION_RAW, "process_map_step.bpmn")) };
  } catch (e) { logActionError("(g1) automatic analysis", e); g.err = String(e.message).split("\n")[0]; }
  record("(g1) AD-22: a recording never analyzed is analyzed by itself on open: no button; the top bar says 'Updating steps and map...' with Cancel, the Overview says so, no log",
    !!(!g.err && g.running && g.during && g.during.cancel && g.during.log === "none" && g.during.analyze === 0 &&
      g.during.line === "Updating steps and map..." && g.during.cancelText === "Cancel" && g.during.overviewShown &&
      g.during.note === "The steps and the map are being drafted from the recording."),
    JSON.stringify({ during: g.during, err: g.err }));
  record("(g1) when it is done the Overview shows the What is left line, the analysis files are written, and the status line and the log are gone",
    !!(!g.err && g.after && g.after.status === "" && g.after.log === "none" && g.files && g.files.stats && g.files.analysis && g.files.bpmn),
    JSON.stringify({ after: g.after, files: g.files }));
  if (g.err) await shot(page3, "fail-overview-auto-analysis.png");

  // (g2) No analysis discards analyst work: a confirmed reference run, an
  // edited, an added and a hidden step (made through the app's own write
  // path) survive the analysis that Apps outside the process runs by itself.
  const work = {};
  try {
    work.ids = await page3.evaluate(async () => {
      const State = require("./state.js"), RM = require("./runs-model.js"), S = require("./session.js");
      const sess = State.getSession();
      const anno = S.ensureAnnoShape(sess.annotations);
      const runs = RM.buildRuns(sess.stats, anno.steps).runs;
      RM.confirmRun(anno, runs, runs[0].caseId, new Date().toISOString());
      const edited = runs[1].visible[0];
      edited.name = "E2E edited step";
      edited.state = "edited";
      const hidden = runs[3].visible[1];
      hidden._prev_state = hidden.state;
      hidden.state = "hidden";
      const host = runs[2].visible[0];
      const added = {
        step_id: "e2e-added-step", session_id: sess.manifest.session_id, case_id: runs[2].caseId,
        name: "E2E added step", description: "", state: "manually_authored",
        time_range: { start: host.time_range.end, end: host.time_range.end },
        evidence: { interaction_event_ids: [], screenshot_refs: [] }, flags: { waste: false },
      };
      anno.steps.push(added);
      await S.persistAnnotations(anno, "e2e analyst work");
      return { confirmed: runs[0].members.map((s) => s.step_id), edited: edited.step_id, hidden: hidden.step_id, added: added.step_id };
    });
    work.before = fs.statSync(RAW_STATS).mtimeMs;
    await page3.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    await page3.locator("#session-layout-steps .editor-toolbar #btn-ignored-apps").click({ timeout: T });
    await page3.waitForSelector("#ia-save", { state: "visible", timeout: T });
    work.dialog = await page3.evaluate(() => ({
      title: ((document.getElementById("ia-save").closest(".modal").querySelector(".modal-header h2") || {}).textContent || "").trim(),
      save: ((document.getElementById("ia-save") || {}).textContent || "").trim(),
    }));
    await page3.locator("#ia-save").click({ timeout: T });
    work.statusSeen = await page3.waitForFunction(() => /^Updating steps and map\.\.\./.test(
      ((document.getElementById("session-pills") || {}).textContent || "").trim()), null, { timeout: T }).then(() => true, () => false);
    await page3.waitForFunction(() => /Steps and map updated/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: 180000 });
    work.ran = fs.statSync(RAW_STATS).mtimeMs > work.before;
    const disk = readRaw();
    const byId = Object.fromEntries((disk.steps || []).map((s) => [s.step_id, s]));
    work.after = {
      confirmed: work.ids.confirmed.map((id) => (byId[id] || {}).state),
      edited: [(byId[work.ids.edited] || {}).state, (byId[work.ids.edited] || {}).name],
      added: [(byId[work.ids.added] || {}).state, (byId[work.ids.added] || {}).name],
      hidden: (byId[work.ids.hidden] || {}).state,
      patternConfirmed: !!(disk.pattern_run && disk.pattern_run.confirmed_at),
    };
  } catch (e) { logActionError("(g2) analyst work survives", e); work.err = String(e.message).split("\n")[0]; }
  const wa = work.after || {};
  record("(g2) Apps outside the process (Steps toolbar) saves and the analysis runs by itself with the status line; confirmed, edited, added and hidden steps all survive it",
    !!(!work.err && work.dialog && work.dialog.title === "Apps outside the process" && work.dialog.save === "Save" && work.statusSeen && work.ran &&
      wa.confirmed && wa.confirmed.length > 0 && wa.confirmed.every((st) => st === "confirmed") && wa.patternConfirmed &&
      same(wa.edited, ["edited", "E2E edited step"]) && same(wa.added, ["manually_authored", "E2E added step"]) &&
      wa.hidden === "hidden"),
    JSON.stringify({ dialog: work.dialog, statusSeen: work.statusSeen, ran: work.ran, after: work.after, err: work.err }));

  // (g3) The log only on failure, its failure sentence first: Re-analyze
  // (Help, Troubleshooting) with events.jsonl moved away fails; with it back
  // the next Re-analyze succeeds and the log goes. (g4) Cancel stops one.
  const EVENTS = path.join(SESSION_RAW, "events.jsonl");
  const reanalyze = async () => {
    await page3.locator("#btn-help").click({ timeout: T });
    await page3.locator('.help-nav-item[data-section="trouble"]').click({ timeout: T });
    await page3.locator("#btn-help-reanalyze").click({ timeout: T });
    await page3.locator(".modal-confirm .modal-ok").click({ timeout: T });
  };
  const fail = {};
  try {
    fs.renameSync(EVENTS, EVENTS + ".away");
    await reanalyze();
    await page3.waitForFunction(() => getComputedStyle(document.getElementById("log-host")).display !== "none", null, { timeout: 120000 });
    fail.failed = await statusNow(page3);
    fail.logFirst = await page3.evaluate(() => {
      const host = document.getElementById("log-host");
      return { first: host.firstElementChild && host.firstElementChild.tagName, open: host.open,
        top: Math.round(host.getBoundingClientRect().top), text: (host.textContent || "").slice(0, 300) };
    });
    fs.renameSync(EVENTS + ".away", EVENTS);
    await reanalyze();
    await page3.waitForFunction(() => /Steps and map updated/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: 180000 });
    fail.recovered = await statusNow(page3);
    // (g4) Cancel. Lane FX1 (report 3, F4): the run moves its outputs into
    // the project only as its last act, so a cancelled one leaves every
    // output byte for byte as it was, and no file of its own behind.
    const OUTPUTS = ["annotations.json", "stats.json", "analysis.json", "process_map_step.bpmn"];
    const snapshot = () => Object.fromEntries(OUTPUTS.map((n) => {
      try { return [n, fs.readFileSync(path.join(SESSION_RAW, n)).toString("base64")]; } catch (_) { return [n, null]; }
    }));
    fail.before = snapshot();
    await reanalyze();
    await page3.waitForSelector("#btn-cancel-normalize", { state: "visible", timeout: T });
    await page3.locator("#btn-cancel-normalize").click({ timeout: T });
    await page3.waitForFunction(() => /Update cancelled/.test((document.getElementById("toast") || {}).textContent || ""),
      null, { timeout: 60000 });
    fail.cancelled = await statusNow(page3);
    fail.toast = await page3.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim());
    const after = snapshot();
    fail.unchanged = OUTPUTS.filter((n) => fail.before[n] !== null && after[n] === fail.before[n]);
    fail.changed = OUTPUTS.filter((n) => after[n] !== fail.before[n]);
    fail.staged = fs.readdirSync(SESSION_RAW).filter((n) => n.endsWith(".pdt-staged"));
  } catch (e) {
    logActionError("(g3) the log on failure", e);
    fail.err = String(e.message).split("\n")[0];
    if (fs.existsSync(EVENTS + ".away")) fs.renameSync(EVENTS + ".away", EVENTS);
  }
  record("(g3) the analysis log shows only when an analysis fails, at the top, its failure sentence first; the next analysis that succeeds takes it away",
    !!(!fail.err && fail.failed && fail.failed.log !== "none" && /^Analysis failed \(exit code \d+\): /.test(fail.failed.failure) &&
      /events\.jsonl/.test(fail.failed.failure) && fail.failed.status === "" &&
      fail.logFirst && fail.logFirst.first === "SUMMARY" && fail.logFirst.open &&
      fail.recovered && fail.recovered.log === "none" && fail.recovered.status === ""),
    JSON.stringify({ failed: fail.failed, logFirst: fail.logFirst, recovered: fail.recovered, err: fail.err }));
  record("(g4) Cancel in the status line stops the analysis: the status line goes, no log (nothing failed)",
    !!(!fail.err && fail.cancelled && fail.cancelled.status === "" && fail.cancelled.log === "none"),
    JSON.stringify(fail.cancelled));
  record("(g4) lane FX1: the toast's claim is true: after Cancel, annotations.json, stats.json, analysis.json and process_map_step.bpmn are byte for byte as they were, and the run left no file",
    !!(!fail.err && /as they were/.test(fail.toast || "") && Array.isArray(fail.unchanged) && fail.unchanged.length === 4 &&
      fail.changed.length === 0 && fail.staged.length === 0),
    JSON.stringify({ toast: fail.toast, unchanged: fail.unchanged, changed: fail.changed, staged: fail.staged, err: fail.err }));

  await close3();

  // (f) Zero page errors across the launches.
  record("(f) zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");

  for (const dir of [SESSION_MARKED, SESSION_STRIPPED, SESSION_RAW]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
  }
  const pass = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;
  console.log("\n[e2e] " + pass + "/" + results.length + " checks passed, " + failCount + " failed");
  if (failCount) {
    console.log("[e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(failCount ? 1 : 0);
})().catch((e) => { console.error("[e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
