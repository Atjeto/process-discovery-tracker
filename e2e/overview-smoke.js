"use strict";
/* C23 (2.0.6): the first video of the chain (external_videos), or the one
   external_video of a project of 2.0.5. */
const firstVideo = (a) => (a && Array.isArray(a.external_videos) && a.external_videos[0]) || (a && a.external_video) || null;
/*
 * Overview e2e smoke: the home of a loaded recording (BA-helper cycle; lane
 * V1 of the step-back review).
 *
 * Launches the REAL viewer three times and asserts the Overview end to end:
 *   (a) the DEFAULT level is Overview (#session-layout-overview visible,
 *       its level button active, the Timeline layout hidden), laid out at its
 *       full height (the Session view scrolls; L5b small-screen fix);
 *   (b) the home leads with the Checklist (a recording's five acts worded
 *       as acts, the last Hand off, each with its tooltip, one button;
 *       AD-29), the project line (the
 *       reference transaction's steps, not every one's; the video and the
 *       transcript with their Attach), then the document; the findings
 *       feed, its evidence and the "include in PDD" ticks are gone, and no
 *       "More" menu or "Analyze session" button exists anywhere;
 *   (c) 2.0.1: no Observations on the Overview, and analysis.json (format
 *       5) without the PDD's rows (pdd_data, pdd_time, steps_signature);
 *   (c2) the moved controls are where they are used (ids kept);
 *   (c3) D4: a marker change applies by itself, with no question; Cancel
 *       leaves Update the steps, whose click applies; Ctrl+Z after it runs
 *       the analysis again by itself;
 *   (d) the analyst path, walked on the demo: every next act lands where it
 *       says (the reference run open in Steps, each other run that differs
 *       open in Steps, one that does not differ never asked for, the
 *       document open on its first empty field), a done stage shows done,
 *       a field saves undoably, the ten fields (trigger, result, volume
 *       and effort, and improvement included) save to annotations.json, the
 *       line then shrinks to one line with Hand off..., the Recents entry
 *       takes the title; (d6b) lane B-V2: the line of what a reader of the
 *       next version will miss shows under the ready Checklist, opens to its
 *       links, the description entry lands on its step in Steps, and a
 *       description written there takes the step out of it; Export, PDD (.docx) with no As-Is copy hands the PDD
 *       the map from the runs
 *       (AD-28), and its sections 5 to 7 read as the document's own (the
 *       systems and the information entered, the volume and effort written,
 *       the re-keyed data under the improvement scope); then with an As-Is
 *       and a To-Be copy it hands both; the Export menu's map items save the
 *       As-Is copy (P2.12);
 *   (h) Attach video syncs with two clicks (click-to-sync), no typed offset;
 *       Cancel leaves the recording as it was;
 *   (k) 2.0.1: a step renamed in Steps, the Overview opened: nothing is
 *       analyzed, and a document field typed there saves;
 *   (e) on a marker-STRIPPED copy the Checklist says no transactions are
 *       marked, and its button opens the Timeline with the Markers panel
 *       showing;
 *   (g) on a copy never analyzed, the analysis runs by itself on open with
 *       one status line (Updating steps and map... with Cancel) and no log;
 *       an analysis keeps confirmed, edited, added and hidden steps (Leave
 *       apps out runs one by itself); the log shows only when an analysis
 *       fails, its failure sentence first; Cancel stops one;
 *   (w0) lane W0, launches 4 and 5: the top bar's next act of the Checklist
 *       (a recording, a project made from nothing, one from a video), its
 *       click landing on the Checklist's button, Undo and Redo by mouse and
 *       by keyboard, the map editor and a read-only hand-off hiding them,
 *       the bar on one line at the window's size in both themes;
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
function readZipBuf(buf, name) {
  const r = zipCentral(buf, (n, p) => {
    if (n !== name) return undefined;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    return method === 0 ? data : zlib.inflateRawSync(data);
  });
  return r === undefined ? null : r;
}
function readZipEntry(buf, name) {
  const r = readZipBuf(buf, name);
  return r === null ? null : r.toString("utf8");
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
/* The text of a document.xml, its runs joined paragraph by paragraph (no
   separator: a heading and the paragraph after it read as one string). */
function docxText(xml) {
  const dec = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return [...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => dec(m[1])).join("");
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
  // line next, then the document.
  const home = await page.evaluate(() => {
    const host = document.getElementById("overview-content");
    const kids = [...host.children].map((c) => c.id || c.className);
    const line = document.getElementById("ov-next");
    const stages = line ? [...line.querySelectorAll(".ov-next-stage")].map((li) =>
      li.dataset.stage + ":" + (li.classList.contains("done") ? "done" : li.classList.contains("next") ? "next" : "-")) : [];
    const text = host.textContent || "";
    const sum = document.querySelector("#ov-summary .ov-summary-line");
    // Plan D5: the video and the transcript, a row each under the line.
    const src = document.getElementById("ov-sources");
    const rows = src ? [...src.querySelectorAll("tr")].map((tr) => ({ head: ((tr.querySelector("th") || {}).textContent || "").trim(),
      what: ((tr.querySelector("[data-summary]") || {}).textContent || "").trim(),
      acts: [...tr.querySelectorAll("button")].map((b) => b.id + ":" + b.textContent.trim()),
      top: Math.round(tr.getBoundingClientRect().top), h: Math.round(tr.getBoundingClientRect().height),
      cut: [...tr.querySelectorAll("th, td, button")].some((e) => e.scrollWidth > e.clientWidth + 1) })) : null;
    return {
      rows, rowsIn: !!(src && src.closest("#ov-summary")) && !!(sum && src && sum.getBoundingClientRect().bottom <= src.getBoundingClientRect().top + 1),
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
      runsSaid: (text.match(/\b4 transactions\b/g) || []).length,
      oldWords: (text.match(/\bruns?\b|What is left/gi) || []).length,
      casesSaid: (text.match(/\b4 cases\b/g) || []).length,
      everyRunCount: /\b30 steps\b|steps confirmed/.test(text),
    };
  }).catch((e) => ({ err: e.message }));
  record("(b) AD-29: the home leads with the Checklist (Mark the transactions, Confirm the reference transaction, Review the other transactions, Write the document, Hand off, each with its tooltip; the first ticked, next the reference transaction, one button), then the project line and the document",
    !!(home && !home.err && same(home.kids, ["ov-next", "ov-summary", "ov-doc"]) &&
      home.lineLabel === "Checklist" &&
      home.next === "pattern" && home.buttons === 1 && home.button === "Confirm transaction 1 in Steps" &&
      home.stages.join(",") === "runs:done,pattern:next,review:-,document:-,handoff:-" &&
      same(home.labels, ["Mark the transactions", "Confirm the reference transaction", "Review the other transactions",
        "Write the document", "Hand off"]) && home.tips.length === 5 && home.tips.every((n) => n > 40)),
    JSON.stringify(home));
  record("(b2) the project line: the name, who recorded it, the transactions said once and the reference transaction's 7 steps (not 30 over every one); plan D5: under it the video and the transcript, a row each (Video: No video, Attach a video...; Transcript: No transcript, Attach a transcript...), each act once, the rows apart and nothing cut; the removed surfaces stay gone; no run or What is left wording on the home",
    !!(home && !home.err && home.removed === 0 && home.summaryH > 0 && home.summaryH < 40 &&
      home.summary === "demo-order-processing · recorded by demo-worker · 4 transactions · 7 steps in transaction 1" &&
      home.rowsIn && same((home.rows || []).map((r) => [r.head, r.what, r.acts]),
        [["Video", "No video", ["btn-attach-video:Attach a video..."]], ["Transcript", "No transcript", ["btn-attach-transcript:Attach a transcript..."]]]) &&
      home.rows.every((r) => r.h >= 24 && !r.cut) && home.rows[1].top >= home.rows[0].top + home.rows[0].h &&
      home.runsSaid === 1 && home.casesSaid === 0 && !home.everyRunCount && home.oldWords === 0),
    JSON.stringify(home && { removed: home.removed, summary: home.summary, summaryH: home.summaryH, rows: home.rows, rowsIn: home.rowsIn,
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

  // (c) 2.0.1: the PDD's rows are the document's alone. The Overview shows
  // no Observations, and analysis.json (format 5) no longer carries the rows
  // or the signature of the steps they were measured from.
  const obs = await page.evaluate(() => {
    const a = require("./state.js").getSession().analysis || {};
    const text = document.getElementById("overview-content").textContent || "";
    return {
      host: !!document.getElementById("ov-observations"),
      rows: document.querySelectorAll("table.ov-rows, #ov-rows-freshness, .ov-rekeyed").length,
      words: ["Observations", "Applications and time", "Measured from the recording"].filter((w) => text.includes(w)),
      format: a.format, keys: ["pdd_data", "pdd_time", "steps_signature"].filter((k) => k in a),
    };
  }).catch((e) => ({ err: e.message }));
  record("(c) 2.0.1: the Overview shows no Observations (the PDD's rows are the document's alone), and analysis.json (format 5) carries no pdd_data, pdd_time or steps_signature",
    !!(obs && !obs.err && !obs.host && obs.rows === 0 && obs.words.length === 0 && obs.format === 5 && obs.keys.length === 0),
    JSON.stringify(obs));

  // (c2) The moved controls, where they are used, with their ids.
  const moved = await page.evaluate(() => {
    const at = (id, sel) => { const el = document.getElementById(id); return el ? { text: (el.textContent || "").trim(), where: !!el.closest(sel) } : null; };
    return {
      attachVideo: at("btn-attach-video", "#ov-summary #ov-sources tr[data-source=\"video\"]"),
      attachTranscript: at("btn-attach-transcript", "#ov-summary #ov-sources tr[data-source=\"transcript\"]"),
      linkRecording: at("btn-link-recording", "#video-pane #no-video"),
      syncVideo: at("btn-sync-video", "#video-pane .video-controls"),
      ignoredApps: at("btn-ignored-apps", "#session-layout-steps .editor-toolbar"),
      // C21: the Remembered step names dialog is gone (the activity library names steps).
      savedNames: !!document.getElementById("btn-remembered-names"),
      // Lane LANES: the Transaction select is gone (a double-click on a
      // transaction shows only it); Lanes is where it was, in the row.
      runSelect: !document.getElementById("case-scope") && !document.getElementById("case-scope-select"),
      lanes: !!(document.getElementById("btn-lanes") || { closest: () => null }).closest("#session-layout-flow .timeline-header"),
    };
  }).catch((e) => ({ err: e.message }));
  record("(c2) the moved controls keep their ids where they are used: Attach a video... and Attach a transcript... in their rows under the project line (plan D5), Attach video... on the video band, Sync video... in the video header, Apps outside the process... in the Steps toolbar (no Remembered step names..., contract C21), Lanes in the Timeline's row (lane LANES: no Transaction select)",
    !!(moved && !moved.err && same(moved.attachVideo, { text: "Attach a video...", where: true }) &&
      same(moved.attachTranscript, { text: "Attach a transcript...", where: true }) &&
      same(moved.linkRecording, { text: "Attach video...", where: true }) &&
      same(moved.syncVideo, { text: "Sync video...", where: true }) &&
      same(moved.ignoredApps, { text: "Apps outside the process...", where: true }) &&
      moved.savedNames === false && moved.runSelect && moved.lanes),
    JSON.stringify(moved));

  // (c3) D4: a marker change in a recording applies by itself a moment
  // later, with no question; Cancel stops that run and leaves Update the
  // steps in the top bar (nothing runs by itself after it); its click
  // applies; Ctrl+Z then takes the marker back and the steps follow it by
  // themselves again (premise check 2: the undo leaves no newer edit, so it
  // marks the markers changed).
  const apply = {};
  const tx = () => page.evaluate(() => (require("./state.js").getSession().stats.case_stats || []).filter((c) => !c.parent_case_id).length);
  const settled = () => page.waitForFunction(() => {
    const s = require("./state.js").getSession(), ME = require("./marker-edits.js");
    return !document.getElementById("run-status") && !require("./views/flow-view.js").analysisBusy() &&
      ME.pendingEditCount(s.annotations.marker_edits, ME.lastAnalysisMs(s)) === 0;
  }, null, { timeout: 120000 });
  try {
    await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
    await page.waitForSelector("#timeline .tl-band", { state: "visible", timeout: T });
    await page.locator("#timeline").scrollIntoViewIfNeeded({ timeout: T });
    apply.before = readAnno().marker_edits || [];
    apply.txBefore = await tx();
    await page.evaluate(() => {
      window.__c3 = { confirms: 0 };
      new MutationObserver(() => { if (document.querySelector(".modal-confirm")) window.__c3.confirms++; })
        .observe(document.body, { childList: true, subtree: true });
    });
    await page.evaluate(() => {
      const tl = document.getElementById("timeline");
      const r = tl.getBoundingClientRect();
      tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true,
        clientX: r.left + r.width * 0.27, clientY: r.top + 4 }));
    });
    await page.locator("#tl-ctx-menu div", { hasText: "Start a transaction here" }).click({ timeout: T });
    await page.locator(".modal-prompt .modal-input").fill("E2E apply check", { timeout: T });
    await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
    apply.noButtonAtOnce = await page.evaluate(() => !document.getElementById("btn-update-steps") &&
      !/Apply/.test((document.getElementById("session-pills") || {}).textContent || ""));
    // The run starts by itself; Cancel stops it.
    await page.waitForSelector("#btn-cancel-normalize", { state: "visible", timeout: T });
    await page.locator("#btn-cancel-normalize").click({ timeout: T });
    await page.waitForSelector("#btn-update-steps", { state: "visible", timeout: 60000 });
    await wait(2500);
    apply.cta = await page.evaluate(() => { const b = document.getElementById("btn-update-steps");
      return b && { text: (b.textContent || "").trim(), title: b.title, inBar: !!b.closest("header.topbar"),
        running: !!document.getElementById("run-status") }; });
    apply.txCancelled = await tx();
    await page.locator("#btn-update-steps").click({ timeout: T });
    await settled();
    apply.txApplied = await tx();
    apply.goneAfter = !(await page.$("#btn-update-steps"));
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press("Control+z");
    apply.undoRan = await page.waitForSelector("#run-status", { timeout: T }).then(() => true, () => false);
    await settled();
    apply.txUndone = await tx();
    apply.after = readAnno().marker_edits || [];
    apply.confirms = await page.evaluate(() => window.__c3.confirms);
  } catch (e) { logActionError("(c3) a marker change applied by itself", e); apply.err = String(e.message).split("\n")[0]; }
  record("(c3) D4: a marker change in a recording asks nothing and shows no button; Cancel of its run leaves Update the steps in the top bar (\"Updates the transactions, their steps and the map with your latest changes.\") and nothing runs by itself; its click applies (one transaction more)",
    !!(!apply.err && apply.noButtonAtOnce && apply.cta && apply.cta.text === "Update the steps" &&
      apply.cta.title === "Updates the transactions, their steps and the map with your latest changes." && apply.cta.inBar && !apply.cta.running &&
      apply.txCancelled === apply.txBefore && apply.txApplied === apply.txBefore + 1 && apply.goneAfter && apply.confirms === 0),
    JSON.stringify(apply));
  record("(c3) D4, premise check 2: Ctrl+Z of the marker change after it applied takes the marker back and the steps follow by themselves (the analysis runs again: one transaction fewer)",
    !!(!apply.err && apply.undoRan && apply.txUndone === apply.txBefore && same(apply.after, apply.before)),
    JSON.stringify({ undoRan: apply.undoRan, txBefore: apply.txBefore, txUndone: apply.txUndone, err: apply.err }));
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
    // 2. The other runs (AD-28): each click opens the first run that
    // differs and is not opened yet; opening it is its review (no Confirm
    // run on them). A run that does not differ is never asked for.
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
    for (let k = 0; k < 40 && (readAnno().opened_runs || []).length < walk.landings.review.length; k++) await wait(125);   // the save is asynchronous
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
  const reviewOk = Array.isArray(L.review) && L.review.length === 2 && L.review.every((l, i) =>
    l.onSteps && l.openRuns === 1 && l.openTitle === "Transaction " + (i + 2) && !l.openIsPattern &&
    l.selectedInOpenRun && l.button === "Review transaction " + (i + 2) + " in Steps" && l.confirm === 0 &&
    l.say === "2 transactions differ from the reference transaction.");
  record("(d3) AD-28: 'Review transaction N in Steps' lands on Steps with that transaction open (no Confirm transaction there), for the two transactions that differ (2 and 3); the line says how many differ; once both were opened the review is ticked (annotations.opened_runs), transaction 4, which does not differ, never asked for",
    !!(reviewOk && walk.afterReview && walk.afterReview.next === "document" && walk.afterReview.done.includes("review") &&
      walk.opened.length === 2),
    JSON.stringify({ review: L.review, after: walk.afterReview, opened: walk.opened }));
  record("(d4) 'Write the document' opens the collapsed document with the cursor in its first empty field ('Document · 0 of 10 written')",
    !!(L.document && L.document.open && L.document.focused === "title" && L.document.status === "0 of 10 written" &&
      walk.afterReview && walk.afterReview.button === "Write the document"),
    JSON.stringify(L.document));

  // 4. A document field saves through the one write path, undoably; then the
  // ten fields, trigger, result, volume and effort, and improvement among them.
  const PURPOSE = "E2E purpose: settle the monthly supplier invoices";
  const values = {
    title: "E2E order intake", purpose: PURPOSE, scope: "From the order e-mail to the order confirmation",
    trigger: "An order e-mail arrives in the shared mailbox", result: "A sales order in SAP and a confirmation to the customer",
    contacts: "Process owner: E2E Owner", business_rules: "Orders above the credit limit need a check",
    exceptions: "A blocked customer stops the run", effort: "About 40 orders a day, 3 minutes each",
    improvement: "Automate the customer lookup and the SAP entry",
  };
  const docProbe = {};
  try {
    const purpose = page.locator('#ov-doc [data-doc="purpose"]');
    await purpose.fill(PURPOSE, { timeout: T });
    await purpose.press("Tab");                          // change fires on leaving the field
    // AD-29: the count names the fields still to write.
    await page.waitForFunction(() => (document.getElementById("ov-doc-status") || {}).textContent ===
      "1 of 10 written. To write: Title, Scope, Trigger, Result, Key contacts, Business rules, Exceptions, " +
      "Volume and effort, Improvement and automation scope", null, { timeout: T });
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
    await page.waitForFunction(() => (document.getElementById("ov-doc-status") || {}).textContent === "10 of 10 written",
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
  record("(d6) the ten fields save to annotations.json, Trigger, Result, Volume and effort and Improvement and automation scope under the keys trigger, result, effort and improvement",
    !!(docProbe.onDisk && Object.entries(values).every(([k, v]) => docProbe.onDisk[k] === v) &&
      docProbe.onDisk.notes === "" && docProbe.onDisk.trigger === values.trigger &&
      docProbe.onDisk.result === values.result && docProbe.onDisk.effort === values.effort &&
      docProbe.onDisk.improvement === values.improvement),
    JSON.stringify({ onDisk: docProbe.onDisk }));
  record("(d6) with the document written, the Checklist shrinks to one short line: no act list, the next act Hand off... (AD-28: no As-Is stage)",
    !!(docProbe.line && docProbe.line.next === "handoff" && docProbe.line.ready && docProbe.line.stages === 0 &&
      docProbe.line.label === "Checklist" && docProbe.line.readyText === "Everything before the hand-off is done." &&
      docProbe.line.button === "Hand off..." && docProbe.line.height > 0 && docProbe.line.height < 60),
    JSON.stringify({ line: docProbe.line }));
  record("(P3.9) once written, the document title names the project on the project line and in Recent projects",
    docProbe.summaryName === "E2E order intake" && !!docProbe.recent &&
      docProbe.recent.heading === "Recent projects" && docProbe.recent.first === "E2E order intake",
    JSON.stringify({ summaryName: docProbe.summaryName, recent: docProbe.recent }));
  record("lane FX3: the capture's request shows on the project line beside the title that names the project (Request: its code), not only in the tooltip",
    docProbe.request === "Request: demo-order-processing", JSON.stringify({ request: docProbe.request }));

  // (d6b) Lane B-V2: with the Checklist ready, what a reader of the next
  // version will miss shows under it: one line with the count, closed; open,
  // its entries are links; the description entry's link lands on its first
  // step in Steps, and writing that step's description there takes the
  // step out of the entry.
  const missProbe = {};
  try {
    const readMiss = () => page.evaluate(() => {
      const d = document.getElementById("ov-miss");
      if (!d) return null;
      const next = document.getElementById("ov-next");
      const sum = d.querySelector("summary");
      const cs = getComputedStyle(sum);
      return {
        open: d.open, afterChecklist: !!next && next.nextElementSibling === d,
        line: ((document.getElementById("ov-miss-line") || {}).textContent || "").trim(),
        // The native marker is not drawn beside the chevron.
        marker: cs.listStyleType, chevrons: d.querySelectorAll(".analysis-module-chevron").length,
        entries: [...d.querySelectorAll(".ov-miss-go")].map((b) => ({ key: b.dataset.miss, text: b.textContent.trim(),
          // A closed details keeps its content laid out but skipped
          // (content-visibility): checkVisibility says whether it shows.
          visible: b.checkVisibility(), h: Math.round(b.getBoundingClientRect().height),
          size: getComputedStyle(b).fontSize })),
      };
    });
    missProbe.before = await readMiss();
    await page.locator("#ov-miss summary").click({ timeout: T });
    missProbe.opened = await readMiss();
    // The entry and the step it leads to, by the Overview's own rule.
    missProbe.want = await page.evaluate(() => {
      const e = require("./views/overview-view.js").missingOf(require("./state.js").getSession())
        .find((x) => x.key === "descriptions");
      return e ? { stepId: e.lead.stepId, count: e.count, text: e.text } : null;
    });
    await page.locator('#ov-miss .ov-miss-go[data-miss="descriptions"]').click({ timeout: T });
    await page.waitForSelector("#step-detail #step-desc", { state: "visible", timeout: T });
    missProbe.landing = Object.assign(await stepsLanding(), {
      selected: await page.evaluate(() => require("./state.js").getSelectedStepId()) });
    await page.locator("#step-desc").fill("E2E: check the customer's credit before the order is entered.", { timeout: T });
    await page.locator("#step-desc").press("Tab");
    for (let k = 0; k < 40; k++) {
      const s = (readAnno().steps || []).find((x) => x.step_id === (missProbe.want || {}).stepId);
      if (s && /^E2E: check the customer/.test(s.description || "")) break;
      await wait(125);
    }
    await goOverview();
    await page.waitForSelector("#ov-miss", { timeout: T });
    missProbe.after = await readMiss();
    missProbe.afterWant = await page.evaluate(() => {
      const e = require("./views/overview-view.js").missingOf(require("./state.js").getSession())
        .find((x) => x.key === "descriptions");
      return e ? { stepId: e.lead.stepId, count: e.count, text: e.text } : null;
    });
    await shot(page, "overview-miss-state.png");
  } catch (e) {
    logActionError("(d6b) what a reader will miss", e);
    missProbe.err = String(e.message).split("\n")[0];
  }
  const mb = missProbe.before, mo = missProbe.opened, mw = missProbe.want;
  record("(d6b) lane B-V2: with the Checklist ready, one closed line under it says how many things a reader of the next version will miss (the Document's chevron, no native marker)",
    !missProbe.err && !!mb && !mb.open && mb.afterChecklist && mb.entries.length > 0 &&
      mb.line === "A reader of the next version will miss " + mb.entries.length + (mb.entries.length === 1 ? " thing" : " things") &&
      mb.marker === "none" && mb.chevrons === 1 && mb.entries.every((x) => !x.visible),
    JSON.stringify({ before: mb, err: missProbe.err }));
  record("(d6b) opened, it lists each entry as a link (12 px or more, at least 24 px high), the descriptions among them",
    !!mo && mo.open && mo.entries.length === mb.entries.length && mo.entries.every((x) => x.visible && x.h >= 24 && parseFloat(x.size) >= 12) &&
      !!mw && mo.entries.some((x) => x.key === "descriptions" && x.text === mw.text),
    JSON.stringify({ opened: mo, want: mw }));
  record("(d6b) the description entry's link opens Steps with its first step selected",
    !!missProbe.landing && !!mw && missProbe.landing.onSteps && missProbe.landing.selected === mw.stepId,
    JSON.stringify({ landing: missProbe.landing, want: mw }));
  record("(d6b) a description written there takes the step out of the entry, and the list stays open",
    !!mw && !!missProbe.after && missProbe.after.open &&
      (missProbe.afterWant === null ? mw.count === 1 && !missProbe.after.entries.some((x) => x.key === "descriptions")
        : missProbe.afterWant.count === mw.count - 1 && missProbe.afterWant.stepId !== mw.stepId),
    JSON.stringify({ want: mw, afterWant: missProbe.afterWant, after: missProbe.after }));

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

  /* Export, PDD (.docx): the Session menu's PDD path (the Checklist's last
     act is the hand-off now). The save dialog is stubbed to a temp path, the
     shell reveal to a no-op. */
  const exportPdd = async (tag) => {
    const out = path.join(os.tmpdir(), "pdt-ov-e2e-" + tag + "-" + Date.now() + ".docx");
    await app.evaluate(({ dialog, shell }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      shell.showItemInFolder = () => {};
    }, out).catch((e) => console.log("stub dialog", e.message));
    await page.evaluate(() => { window.__pddMaps = null; window.__pddOpts = null; window.__bpmnRenders = []; });
    await goOverview();
    await page.click("#btn-session-export-menu").catch((e) => console.log("export menu click", e.message));
    await page.click("#btn-session-pdd").catch((e) => console.log("export click", e.message));
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
  record("(d8) Export, PDD (.docx) writes a .docx through the Session menu's PDD path, from the Overview and back on it with the level bar in sync; no status line or log left",
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

  // 2.0.1: the PDD's section 5 names each system with the information
  // entered in it (no values, no screens, no steps), section 6 prints the
  // Volume and effort written on the Overview (never the recorded times, in
  // a step's line neither), and the re-keyed data is said under the
  // improvement scope.
  const docTables = docxTables(first.xml);
  const systemsTable = docTables.find((t) => same(t[0], ["System", "Information entered"])) || null;
  const pddText = docxText(first.xml);
  const pdd = {
    systems: systemsTable ? systemsTable.slice(1).map((r) => r[0]) : null,
    oldTables: docTables.filter((t) => ["Field", "Transaction"].includes(t[0][0]) || same(t[0].slice(0, 2), ["System", "Screens"])).length,
    effort: pddText.includes("6. Volume and effort" + values.effort),
    rekeyed: pddText.includes("Re-keyed data") &&
      pddText.includes("Product code (Salesforce) is typed again as Material number (SAP) in every transaction."),
    rekeyedAfterImprovement: pddText.indexOf("Re-keyed data") > pddText.indexOf(values.improvement),
    times: ["Time per transaction", "Time in each application", "walkthrough", " on average"].filter((w) => pddText.includes(w)),
  };
  record("(d9b) 2.0.1: the exported PDD's section 5 lists each system with the information entered in it, section 6 prints the Volume and effort written on the Overview, the re-keyed data is under the improvement scope, and no recorded time or data table is printed",
    !!(systemsTable && pdd.systems.includes("Salesforce") && pdd.systems.includes("SAP") &&
      !pdd.systems.some((s) => /Chrome/.test(s)) && systemsTable.slice(1).every((r) => r.length === 2 && r[1]) &&
      pdd.oldTables === 0 && pdd.effort && pdd.rekeyed && pdd.rekeyedAfterImprovement && pdd.times.length === 0),
    JSON.stringify({ systems: systemsTable, oldTables: pdd.oldTables, effort: pdd.effort, rekeyed: pdd.rekeyed,
      after: pdd.rekeyedAfterImprovement, times: pdd.times }));

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
    // Lane MV: a new copy is kept at its first change (a system label moved a
    // little), after the editor's delayed write.
    await page.evaluate(() => {
      const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
      ed.get("modeling").moveElements([ed.get("elementRegistry").filter((e) => /^(?:Sub\d+_)?TextAnnotation_system/.test(e.id))[0]], { x: 0, y: 8 });
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
      mapProbe.line && mapProbe.line.ready && mapProbe.line.next === "handoff" && mapProbe.line.button === "Hand off..."),
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
  const noExternal = () => !firstVideo(readAnno());
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
    // Lane W2: this recording has screenshots (its files are not copied
    // here), so where no video shows the stage shows its screen from them,
    // under the no-video line with Attach video.
    attach.afterCancel = await page.evaluate(() => ({
      card: !!document.getElementById("video-sync-card"),
      screen: document.getElementById("video-pane").classList.contains("on-screen") && !document.getElementById("video-screen").hidden,
      noVideo: getComputedStyle(document.getElementById("no-video")).display !== "none",
      videoShown: getComputedStyle(document.getElementById("video")).display !== "none",
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
    const ev = firstVideo(readAnno());
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
  record("(h) Attach video opens the Timeline with the chosen video and the two-click sync card, never a typed offset; Cancel writes nothing and brings back what showed without a video (lane W2: the screen from the screenshots, under the no-video line)",
    !!(!attach.err && cp.onTimeline && /^Step 1 of 2: pause the video at a recognizable moment, then click Mark frame\./.test(cp.card) &&
      cp.prompt === 0 && cp.videoShown && cp.nothingYet && !ac.card && ac.screen && ac.noVideo && !ac.videoShown && ac.nothingWritten),
    JSON.stringify({ cancelPhase: cp, afterCancel: ac, err: attach.err }));
  record("(h) Mark frame, then a click on the timeline, attaches the video with the offset of that moment (stored relative to the folder it sits in, V2 item 5); the video's row then names its file with Replace the video... (plan D5) and the video header offers Sync video",
    !!(!attach.err && /^Step 2 of 2: click the matching moment on the timeline/.test(attach.step2 || "") && attach.stillNothing &&
      attach.saved && attach.saved.path === path.basename(VIDEO) && Math.abs(attach.saved.offset - attach.wantOffset) <= 3000 &&
      attach.after && attach.after.line === path.basename(VIDEO) && attach.after.button === "Replace the video..." && attach.after.sync),
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
  const storedPath = () => ((firstVideo(readAnno()) || {}).path || null);
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
      const a = s && s.annotations;
      const p = a && ((Array.isArray(a.external_videos) && a.external_videos[0]) || a.external_video || {}).path;
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
    // Plan D5: the video's row and its acts.
    vid.line = await page.evaluate(() => [...document.querySelectorAll('#ov-summary #ov-sources tr[data-source="video"] button')].map((b) => b.id + ":" + b.textContent.trim()));
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
  record("(h2) Remove video (Remove the video in the video's row, plan D5, and Remove video beside Sync video) asks first, then takes out the entry and its copy in video/; Ctrl+Z brings both back",
    !!(!vid.err && Array.isArray(vid.line) &&
      JSON.stringify(vid.line) === JSON.stringify(["btn-attach-video:Replace the video...", "btn-remove-video:Remove the video", "btn-add-video:Add a video..."]) &&
      vid.header && vid.header.shown && vid.header.text === "Remove video" &&
      /Remove the video\?/.test(vid.confirm || "") && /copy in the project's video folder is deleted/.test(vid.confirm || "") &&
      /Ctrl\+Z brings it back/.test(vid.confirm || "") &&
      vid.removed && vid.removed.stored === null && vid.removed.fileGone && vid.removed.line === "No video" && !vid.removed.removeBtn &&
      vid.undoRemove && vid.undoRemove.stored === "video/first call.webm" && vid.undoRemove.fileBack && vid.lineAfterUndo === "first call.webm"),
    JSON.stringify({ line: vid.line, header: vid.header, confirm: vid.confirm, removed: vid.removed, undoRemove: vid.undoRemove, after: vid.lineAfterUndo }));

  // (k) 2.0.1: opening the Overview analyzes nothing. The rows refresh that
  // measured the PDD's rows again as the Overview opened is gone with them:
  // a step renamed in Steps, then the Overview opened, starts no analysis
  // (analysis.json stays as it was), and a document field typed there saves.
  const NAME1 = "E2E renamed: Look up the customer account";
  const idle = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
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
  const fr = {};
  try {
    await idle();
    await renameFirst(NAME1);
    const analysisFile = path.join(SESSION_MARKED, "analysis.json");
    fr.before = fs.statSync(analysisFile).mtimeMs;
    await page.evaluate(() => { document.querySelector('.view-mode-btn[data-level="overview"]').click(); });
    await wait(1500);
    fr.busy = await page.evaluate(() => require("./views/flow-view.js").analysisBusy());
    fr.pills = await page.evaluate(() => (document.getElementById("session-pills").textContent || "").replace(/\s+/g, " ").trim());
    fr.after = fs.statSync(analysisFile).mtimeMs;
    await page.evaluate(() => {
      const d = document.getElementById("ov-doc");
      d.open = true;
      d.querySelector('[data-doc="notes"]').focus();
    });
    await page.keyboard.type("E2E: typed after a rename");
    await page.keyboard.press("Tab");
    for (let k = 0; k < 40 && !((readAnno().document || {}).notes || "").startsWith("E2E: typed"); k++) await wait(125);
    fr.typed = (readAnno().document || {}).notes || "";
  } catch (e) {
    logActionError("(k) the Overview opened after a rename", e);
    fr.err = String(e.message).split("\n")[0];
    await shot(page, "fail-overview-open-after-rename.png");
  }
  record("(k) 2.0.1: a step renamed in Steps, then the Overview opened, analyzes nothing (no status line, analysis.json as it was), and a document field typed there saves",
    !!(!fr.err && fr.busy === false && !/Updating steps and map/.test(fr.pills || "") && fr.before === fr.after &&
      fr.typed === "E2E: typed after a rename"),
    JSON.stringify(fr));

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
  record("(e) marker-stripped session: the Checklist says no transactions are marked, with the instruction (D4: nothing to apply after it) and 'Mark the transactions on the Timeline'",
    !!(markRuns && !markRuns.err && markRuns.next === "runs" && /no transactions marked/i.test(markRuns.lineText || "") &&
      /Start a transaction here[.]/.test(markRuns.lineText || "") && !/Apply/.test(markRuns.lineText || "") &&
      markRuns.button === "Mark the transactions on the Timeline" && markRuns.badges === 0),
    JSON.stringify(markRuns));
  if (!(markRuns && markRuns.next === "runs")) await shot(page2, "fail-overview-mark-runs.png");

  await shot(page2, "overview-unsegmented-state.png");

  // (e2) The button LANDS: the Timeline shows, with (lane PANE: the Markers
  // tab is gone) the pane's Steps tab, where each transaction's header is.
  // Another tab is chosen first, so the landing is the button's doing.
  const markersTabBefore = await page2.evaluate(() => {
    require("./views/timeline-pane.js").showTab("transcript");
    const t = document.querySelector('.anno-tab[data-anno="steps"]');
    return !!(t && t.classList.contains("active"));
  }).catch(() => null);
  await page2.click("#btn-ov-next").catch((e) => console.log("mark-runs click", e.message));
  await wait(700);
  const landed = await page2.evaluate(() => {
    const flow = document.querySelector("#session-layout-flow");
    const tab = document.querySelector('.anno-tab[data-anno="steps"]');
    const panel = document.querySelector('.anno-panel[data-panel="steps"]');
    const r = panel ? panel.getBoundingClientRect() : null;
    return {
      flowVisible: !!(flow && getComputedStyle(flow).display !== "none"),
      markersTabActive: !!(tab && tab.classList.contains("active")),
      markersPanelVisible: !!(panel && getComputedStyle(panel).display !== "none"),
      panelOnScreen: !!(r && r.height > 0 && r.top < window.innerHeight && r.bottom > 0),
    };
  }).catch((e) => ({ err: e.message }));
  record("(e2) 'Mark the transactions on the Timeline' lands on the Timeline with the pane's Steps tab (lane PANE: in place of the Markers panel) showing on screen",
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

  // ================= Launch 4 (lane W0): the next act, Undo and Redo ======
  // The top bar names the Checklist's next act on the Timeline, Steps and the
  // Map (a click lands on the Checklist's own button) and carries Undo and
  // Redo, what Ctrl+Z and Ctrl+Y call; checked on a recording, a project
  // made from nothing and one made from a video, then on a hand-off unzipped
  // by hand (read only).
  const W0_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-w0-"));
  const SESSION_W0 = makeTempSession({ stripMarkers: false });
  const W0_ANNO = path.join(SESSION_W0, "annotations.json");
  const readW0 = () => JSON.parse(fs.readFileSync(W0_ANNO, "utf-8"));
  const w0 = {};
  const SIZE = process.env.PDT_E2E_WINDOW || "default";
  const topBar = (pg) => pg.evaluate(() => {
    const one = (id) => {
      const e = document.getElementById(id);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { shown: e.checkVisibility(), text: e.textContent.trim(), title: e.title, dis: e.getAttribute("aria-disabled"),
        left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), cut: e.scrollWidth > e.clientWidth };
    };
    const bar = document.querySelector(".topbar");
    // The items drawn (the spacer and an empty status line have no height):
    // one line when every item starts above the end of every other.
    const kids = [...bar.children].filter((k) => k.checkVisibility() && k.getBoundingClientRect().width > 0 && k.getBoundingClientRect().height > 0);
    const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top));
    const bottoms = kids.map((k) => Math.round(k.getBoundingClientRect().bottom));
    const s = require("./state.js").getSession();
    const Ov = require("./views/overview-view.js");
    return {
      next: one("btn-next-act"), undo: one("btn-undo"), redo: one("btn-redo"),
      save: one("save-state"), exportBtn: one("btn-session-export-menu"),
      levels: [...document.querySelectorAll(".view-mode-btn")].map((b) => { const r = b.getBoundingClientRect(); return b.checkVisibility() && r.width > 20; }),
      oneLine: Math.max(...tops) < Math.min(...bottoms) && bar.getBoundingClientRect().height < 50,
      barRight: Math.round(Math.max(...kids.map((k) => k.getBoundingClientRect().right))), width: innerWidth,
      level: require("./state.js").getLevel(),
      rule: s && s.analysis ? Ov.nextActText(Ov.pathState(s)) : null,
      checklistNext: (document.getElementById("ov-next") || { dataset: {} }).dataset.next || null,
    };
  });
  const toLevel = async (pg, l) => { await pg.locator('.view-mode-btn[data-level="' + l + '"]').click({ timeout: T }); await wait(400); };
  const fits = (b) => !!(b && b.oneLine && b.barRight <= b.width && b.levels.every(Boolean) && b.save.shown && b.exportBtn.shown &&
    (!b.next.shown || (b.next.right <= b.undo.left && b.next.title === (b.next.cut ? "Opens the Checklist. " + b.next.text : "Opens the Checklist."))));
  const nameOnDisk = (id) => ((readW0().steps || []).find((s) => s.step_id === id) || {}).name;
  if (!normalize(SESSION_W0)) record("(w0) re-normalize the temp recording (prerequisite)", false, "no deps-bearing Python");
  let app4, page4, close4;
  try {
    ({ app: app4, page: page4, close: close4 } = await launch(SESSION_W0, pageErrors));
  } catch (e) {
    console.error("FATAL: could not launch viewer (lane W0):", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  try {
    await page4.waitForFunction(() => !require("./views/flow-view.js").analysisBusy(), null, { timeout: 120000 });
    w0.overview = await topBar(page4);
    w0.levels = {};
    for (const l of ["flow", "steps", "map"]) { await toLevel(page4, l); w0.levels[l] = await topBar(page4); }
    for (const theme of ["light", "dark"]) {
      await page4.evaluate((t) => require("./theme.js").setTheme(t), theme);
      await wait(300);
      w0["fit_" + theme] = await topBar(page4);
      await page4.screenshot({ path: path.join(OUT, "overview-w0-topbar-" + theme + "-" + SIZE + ".png"), clip: { x: 0, y: 0, width: w0.levels.map.width, height: 64 } });
    }
    await page4.evaluate(() => require("./theme.js").setTheme("light"));
    // The click opens the Overview with the keyboard on the Checklist's button.
    await toLevel(page4, "steps");
    await page4.locator("#btn-next-act").click({ timeout: T });
    w0.focused = await page4.waitForFunction(() => document.activeElement && document.activeElement.id === "btn-ov-next", null, { timeout: 5000 })
      .then(() => true, () => false);
    w0.afterClick = await topBar(page4);
    w0.nextAct = await page4.evaluate(() => (document.getElementById("btn-ov-next") || { dataset: {} }).dataset.nextAct || null);
    // A step renamed: Undo takes it back and Redo brings it again, by mouse.
    await toLevel(page4, "steps");
    await page4.waitForSelector("#step-list .run-group.pattern", { state: "visible", timeout: T });
    if (!(await page4.evaluate(() => document.querySelector("#step-list .run-group.pattern").classList.contains("open")))) {
      await page4.locator("#step-list .run-group.pattern > .run-row").click({ timeout: T });
    }
    const row = page4.locator("#step-list .run-group.pattern .step-row").first();
    const sid = await row.getAttribute("data-step-id");
    w0.before = nameOnDisk(sid);
    w0.stacksBefore = await topBar(page4);
    await row.click({ timeout: T });
    const W0_NAME = "E2E W0: Check the customer";
    await page4.locator("#step-name").fill(W0_NAME, { timeout: T });
    await page4.locator("#step-name").press("Enter");
    await page4.waitForFunction(() => document.getElementById("btn-undo").getAttribute("aria-disabled") === "false", null, { timeout: T });
    w0.renamed = { disk: nameOnDisk(sid), bar: await topBar(page4) };
    await page4.locator("#btn-undo").click({ timeout: T });
    await page4.waitForFunction(() => document.getElementById("btn-redo").getAttribute("aria-disabled") === "false", null, { timeout: T });
    await wait(400);
    w0.undone = { disk: nameOnDisk(sid), bar: await topBar(page4) };
    await page4.locator("#btn-redo").click({ timeout: T });
    await page4.waitForFunction(() => document.getElementById("btn-redo").getAttribute("aria-disabled") === "true", null, { timeout: T });
    await wait(400);
    w0.redone = { disk: nameOnDisk(sid), bar: await topBar(page4) };
    // A click on Redo with nothing to redo does nothing (no "Nothing to redo").
    await page4.evaluate(() => { const t = document.getElementById("toast"); if (t) t.textContent = ""; });
    // (Playwright waits for an aria-disabled button to be enabled: force it.)
    await page4.locator("#btn-redo").click({ timeout: T, force: true });
    await wait(500);
    w0.idleRedo = { disk: nameOnDisk(sid), toast: await page4.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim()) };
    // By keyboard: Tab from the next act to Undo, Enter; Tab to Redo, Enter.
    await page4.locator("#btn-next-act").focus();
    await page4.keyboard.press("Tab");
    w0.tabUndo = await page4.evaluate(() => document.activeElement && document.activeElement.id);
    await page4.keyboard.press("Enter");
    await page4.waitForFunction(() => document.getElementById("btn-redo").getAttribute("aria-disabled") === "false", null, { timeout: T });
    await wait(400);
    w0.keyUndo = nameOnDisk(sid);
    await page4.keyboard.press("Tab");
    w0.tabRedo = await page4.evaluate(() => document.activeElement && document.activeElement.id);
    await page4.keyboard.press("Enter");
    await page4.waitForFunction(() => document.getElementById("btn-redo").getAttribute("aria-disabled") === "true", null, { timeout: T });
    await wait(400);
    w0.keyRedo = nameOnDisk(sid);
    w0.name = W0_NAME;
    // The next act follows a change: Confirm transaction, no reload.
    await page4.locator('#step-list .run-group.pattern [data-act="confirm-run"]').click({ timeout: T });
    await page4.waitForFunction(() => /review/.test(document.getElementById("btn-next-act").textContent), null, { timeout: T }).catch(() => {});
    w0.confirmed = await topBar(page4);
    // The map editor: the keys are the map's, so Undo and Redo are not shown.
    await toLevel(page4, "map");
    await page4.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(), null, { timeout: 180000 });
    await page4.locator("#btn-fork-refmap").click({ timeout: T });
    await page4.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: T });
    await wait(500);
    w0.editor = await topBar(page4);
    await page4.locator("#btn-refmap-editor-close").click({ timeout: T });
    await page4.waitForSelector("#refmap-editor-overlay", { state: "hidden", timeout: T });
    await wait(500);
    w0.editorClosed = await topBar(page4);
  } catch (e) { logActionError("W0 recording", e); w0.err = String(e.message).split("\n")[0]; await shot(page4, "fail-overview-w0.png"); }
  const WL = w0.levels || {};
  record("(w0) a recording: the next act is not on the Overview; on the Timeline, Steps and the Map it reads the Checklist's next act, " +
    "the same as the Checklist's rule, with Undo and Redo shown and aria-disabled while nothing was changed",
    !w0.err && w0.overview && !w0.overview.next.shown && w0.overview.undo.shown && w0.overview.redo.shown &&
      ["flow", "steps", "map"].every((l) => WL[l] && WL[l].next.shown && WL[l].next.text === "Next: confirm the reference transaction" &&
        WL[l].next.text === WL[l].rule && WL[l].undo.text === "Undo" && WL[l].redo.text === "Redo" &&
        WL[l].undo.title === "Undoes the last change. Key: Ctrl+Z" && WL[l].redo.title === "Does the undone change again. Key: Ctrl+Y" &&
        WL[l].undo.dis === "true" && WL[l].redo.dis === "true"),
    JSON.stringify({ overview: w0.overview && w0.overview.next, levels: Object.keys(WL).map((l) => [l, WL[l].next, WL[l].undo.dis, WL[l].redo.dis]), err: w0.err }));
  record("(w0) the top bar keeps one line at " + SIZE + " in both themes: the levels, the save state and Export readable, the next act before Undo, " +
    "its tooltip 'Opens the Checklist.' (with the whole text after it when the text is cut)",
    !w0.err && fits(w0.fit_light) && fits(w0.fit_dark) && ["flow", "steps", "map"].every((l) => fits(WL[l])),
    JSON.stringify({ light: w0.fit_light && [w0.fit_light.oneLine, w0.fit_light.barRight, w0.fit_light.next], dark: w0.fit_dark && [w0.fit_dark.oneLine, w0.fit_dark.next] }));
  record("(w0) a click on the next act opens the Overview with the keyboard on the Checklist's button for that act",
    !w0.err && w0.focused && w0.afterClick && w0.afterClick.level === "overview" && !w0.afterClick.next.shown &&
      w0.afterClick.checklistNext === "pattern" && w0.nextAct === "pattern",
    JSON.stringify({ focused: w0.focused, level: w0.afterClick && w0.afterClick.level, next: w0.afterClick && w0.afterClick.checklistNext, act: w0.nextAct }));
  record("(w0) Undo takes back a typed step name and Redo brings it again, by mouse; each follows the stacks; Redo with nothing to redo does nothing",
    !w0.err && w0.before && w0.before !== w0.name && w0.stacksBefore.undo.dis === "true" &&
      w0.renamed.disk === w0.name && w0.renamed.bar.undo.dis === "false" && w0.renamed.bar.redo.dis === "true" &&
      w0.undone.disk === w0.before && w0.undone.bar.redo.dis === "false" &&
      w0.redone.disk === w0.name && w0.redone.bar.redo.dis === "true" && w0.redone.bar.undo.dis === "false" &&
      w0.idleRedo.disk === w0.name && !/Nothing to redo/.test(w0.idleRedo.toast),
    JSON.stringify({ before: w0.before, renamed: w0.renamed && w0.renamed.disk, undone: w0.undone && w0.undone.disk, redone: w0.redone && w0.redone.disk,
      idleRedo: w0.idleRedo, err: w0.err }));
  record("(w0) by keyboard: Tab from the next act reaches Undo, Enter undoes; Tab reaches Redo, Enter redoes",
    !w0.err && w0.tabUndo === "btn-undo" && w0.keyUndo === w0.before && w0.tabRedo === "btn-redo" && w0.keyRedo === w0.name,
    JSON.stringify({ tabUndo: w0.tabUndo, keyUndo: w0.keyUndo, tabRedo: w0.tabRedo, keyRedo: w0.keyRedo }));
  record("(w0) the next act follows a change without a reload: Confirm transaction makes it Review the other transactions",
    !w0.err && w0.confirmed && w0.confirmed.next.text === "Next: review the other transactions" && w0.confirmed.rule === w0.confirmed.next.text,
    JSON.stringify(w0.confirmed && w0.confirmed.next));
  record("(w0) while the map editor is open, Undo, Redo and the next act are not shown; closed, they are back",
    !w0.err && w0.editor && !w0.editor.undo.shown && !w0.editor.redo.shown && !w0.editor.next.shown &&
      w0.editorClosed.undo.shown && w0.editorClosed.redo.shown && w0.editorClosed.next.shown,
    JSON.stringify({ editor: w0.editor && [w0.editor.undo.shown, w0.editor.redo.shown, w0.editor.next.shown],
      closed: w0.editorClosed && [w0.editorClosed.undo.shown, w0.editorClosed.redo.shown, w0.editorClosed.next.shown] }));

  // A project made from nothing, then one made from a video, in the same window.
  const w0b = {};
  const settledW0 = () => page4.waitForFunction(() => {
    const s = require("./state.js").getSession();
    return !!(s && s.stats && s.analysis) && !document.getElementById("run-status") && !require("./views/flow-view.js").analysisBusy();
  }, null, { timeout: 120000 });
  const openedW0 = (folder) => page4.waitForFunction((f) => {
    const s = require("./state.js").getSession();
    return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase();
  }, path.resolve(folder), { timeout: 60000 });
  const BLANK = path.join(W0_TMP, "Empty project");
  const FROM_VIDEO = path.join(W0_TMP, "Video project");
  const VIDEO_SRC = path.join(REPO, "demo", "Order to cash", "video", "Order to cash demo.webm");
  const VIDEO_COPY = path.join(W0_TMP, "call.webm");
  try {
    fs.copyFileSync(VIDEO_SRC, VIDEO_COPY);
    await app4.evaluate(({ dialog, shell }, a) => {
      const open = a.open.slice(), save = a.save.slice();
      dialog.showOpenDialog = async () => { const f = open.shift(); return f ? { canceled: false, filePaths: [].concat(f) } : { canceled: true, filePaths: [] }; };
      dialog.showSaveDialog = async () => { const f = save.shift(); return f ? { canceled: false, filePath: f } : { canceled: true }; };
      shell.showItemInFolder = () => {};
    }, { open: [[VIDEO_COPY]], save: [BLANK, FROM_VIDEO] });
    await page4.click("#btn-new-menu");
    await page4.click("#btn-new-blank");
    await openedW0(BLANK);
    await settledW0();
    await toLevel(page4, "steps");
    w0b.blank = await topBar(page4);
    // + Add step asks for the name; the step then has a name of its own and
    // no description, so it is not written yet.
    await page4.locator("#btn-add-manual-step").click({ timeout: T });
    await page4.waitForSelector(".modal-prompt .modal-input", { timeout: T });
    await page4.fill(".modal-prompt .modal-input", "Check the customer");
    await page4.click(".modal-prompt .modal-ok");
    await page4.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
    await page4.waitForFunction(() => /write the steps/.test(document.getElementById("btn-next-act").textContent), null, { timeout: T }).catch(() => {});
    w0b.added = await topBar(page4);
    await page4.locator("#step-desc").fill("Look the customer up in the CRM.", { timeout: T });
    await page4.locator("#step-desc").press("Tab");
    await page4.waitForFunction(() => /write the document/.test(document.getElementById("btn-next-act").textContent), null, { timeout: T }).catch(() => {});
    w0b.written = await topBar(page4);
    await page4.locator("#btn-next-act").click({ timeout: T });
    w0b.focused = await page4.waitForFunction(() => document.activeElement && document.activeElement.id === "btn-ov-next", null, { timeout: 5000 })
      .then(() => true, () => false);
    w0b.blankAct = await page4.evaluate(() => (document.getElementById("btn-ov-next") || { dataset: {} }).dataset.nextAct || null);
    await page4.click("#btn-new-menu");
    await page4.click("#btn-new-from-video");
    await openedW0(FROM_VIDEO);
    await settledW0();
    await wait(600);
    w0b.video = await topBar(page4);
  } catch (e) { logActionError("W0 new projects", e); w0b.err = String(e.message).split("\n")[0]; await shot(page4, "fail-overview-w0-new.png"); }
  record("(w0) a project made from nothing: Next: add the steps, then Next: write the steps (0 of 1) once a step is added, " +
    "then Next: write the document (0 of 10) once it is named and described; a click lands on the Checklist's Write the document",
    !w0b.err && w0b.blank && w0b.blank.next.text === "Next: add the steps" && w0b.blank.undo.dis === "true" &&
      w0b.added.next.text === "Next: write the steps (0 of 1)" && w0b.added.undo.dis === "false" &&
      w0b.written.next.text === "Next: write the document (0 of 10)" && w0b.written.rule === w0b.written.next.text &&
      w0b.focused && w0b.blankAct === "document",
    JSON.stringify({ blank: w0b.blank && w0b.blank.next.text, added: w0b.added && w0b.added.next.text, written: w0b.written && w0b.written.next.text,
      focused: w0b.focused, act: w0b.blankAct, err: w0b.err }));
  record("(w0) a project made from a video opens on the Timeline with Next: add the steps, and Undo empty (another project opened)",
    !w0b.err && w0b.video && w0b.video.level === "flow" && w0b.video.next.shown && w0b.video.next.text === "Next: add the steps" &&
      w0b.video.undo.dis === "true" && w0b.video.redo.dis === "true" && fits(w0b.video),
    JSON.stringify(w0b.video && { level: w0b.video.level, next: w0b.video.next, undo: w0b.video.undo.dis }));
  await close4();

  // A hand-off unzipped by hand opens read only: none of the three shows.
  const RO_PARENT = path.join(W0_TMP, "unzipped");
  const RO_PROJECT = path.join(RO_PARENT, "Order intake");
  const w0r = {};
  try {
    fs.cpSync(SESSION_W0, RO_PROJECT, { recursive: true });
    const a = JSON.parse(fs.readFileSync(path.join(RO_PROJECT, "annotations.json"), "utf-8"));
    a.handoffs = [{ version: 1, handed_off_at: "2026-11-10T09:00:00.000Z", by: "e2e", note: "W0" }];
    fs.writeFileSync(path.join(RO_PROJECT, "annotations.json"), JSON.stringify(a, null, 2));
    fs.writeFileSync(path.join(RO_PARENT, "Order intake v1 PDD.docx"), "");
    const { page: page5, close: close5 } = await launch(RO_PROJECT, pageErrors);
    try {
      w0r.ro = await page5.evaluate(() => !!(require("./state.js").getSession() || {}).readOnly);
      w0r.overview = await topBar(page5);
      await toLevel(page5, "steps");
      w0r.steps = await topBar(page5);
    } finally { await close5(); }
  } catch (e) { logActionError("W0 read only", e); w0r.err = String(e.message).split("\n")[0]; }
  record("(w0) a hand-off opened read only shows no next act, no Undo and no Redo, on the Overview or Steps",
    !w0r.err && w0r.ro && [w0r.overview, w0r.steps].every((b) => b && !b.next.shown && !b.undo.shown && !b.redo.shown),
    JSON.stringify({ ro: w0r.ro, overview: w0r.overview && [w0r.overview.next.shown, w0r.overview.undo.shown], steps: w0r.steps && [w0r.steps.next.shown, w0r.steps.undo.shown], err: w0r.err }));
  for (const dir of [SESSION_W0, W0_TMP]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
  }

  // ================= Launches 6 to 8 (lane C, contract C24): what the SME gives
  // The capture app's end summary writes sme_answers and sme_files on the
  // manifest (written here into a temp copy, the capture side being another
  // lane): the answers wait under their document fields with Use and
  // Dismiss, the files become attachments of the whole project once, and the
  // PDD names who recorded in full. Then the same project opened again adds
  // nothing, and a hand-off unzipped by hand writes nothing.
  const SME_BASE = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-ov-sme-"));
  const SME_PROJECT = path.join(SME_BASE, "Order intake");
  const SME_RO = path.join(SME_BASE, "unzipped", "Order intake");
  const SME_ANSWERS = { trigger: "An order mail from a customer in the shared mailbox",
    result: "A sales order in SAP and a confirmation sent to the customer",
    effort: "About 30 a day, 4 minutes each", exceptions: "A new customer: I create them first in Salesforce" };
  const SME_FILES = [
    { file: "Order 10900.msg", label: "Order 10900.msg", added_at: "2026-11-12T09:00:00.000Z" },
    { file: "Price list 2026.xlsx", label: "Price list 2026.xlsx", added_at: "2026-11-12T09:01:00.000Z" },
    { file: "Delivery note.pdf", label: "Delivery note.pdf", added_at: "2026-11-12T09:02:00.000Z" },
  ];
  const SME_WHO = "Maria Keller, sales assistant, Operations";
  const smeAnnoPath = (dir) => path.join(dir, "annotations.json");
  const smeAnno = (dir) => JSON.parse(fs.readFileSync(smeAnnoPath(dir), "utf-8"));
  const smeOfAnno = (a) => (a.attachments || []).filter((x) => x && x.from === "sme");
  const sme = {};
  try {
    const src = makeTempSession({ stripMarkers: false });
    fs.cpSync(src, SME_PROJECT, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
    if (!normalize(SME_PROJECT)) throw new Error("no deps-bearing Python");
    const m = JSON.parse(fs.readFileSync(path.join(SME_PROJECT, "manifest.json"), "utf-8"));
    m.sme_answers = SME_ANSWERS;
    m.sme_files = SME_FILES;
    m.config = Object.assign({}, m.config, { worker: Object.assign({}, (m.config || {}).worker, { name: "Maria Keller", role: "sales assistant", bu: "Operations" }) });
    fs.writeFileSync(path.join(SME_PROJECT, "manifest.json"), JSON.stringify(m, null, 2));
    // Two of the three files came with the recording; the third did not.
    fs.mkdirSync(path.join(SME_PROJECT, "attachments"), { recursive: true });
    fs.writeFileSync(path.join(SME_PROJECT, "attachments", "Order 10900.msg"), "An example order mail.");
    fs.writeFileSync(path.join(SME_PROJECT, "attachments", "Price list 2026.xlsx"), "An example price list.");
    // The hand-off unzipped by hand, made before the first open: nothing taken yet.
    fs.cpSync(SME_PROJECT, SME_RO, { recursive: true });
    const ra = smeAnno(SME_RO);
    ra.handoffs = [{ version: 1, handed_off_at: "2026-11-12T09:30:00.000Z", by: "e2e", note: "C24" }];
    fs.writeFileSync(smeAnnoPath(SME_RO), JSON.stringify(ra, null, 2));
    fs.writeFileSync(path.join(SME_BASE, "unzipped", "Order intake v1 PDD.docx"), "");
  } catch (e) { sme.err = "setup: " + String(e.message).split("\n")[0]; }

  const smeSettled = (pg, folder) => pg.waitForFunction((f) => {
    const s = require("./state.js").getSession();
    return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase() && !!s.analysis &&
      !require("./views/flow-view.js").analysisBusy() && !document.getElementById("run-status");
  }, path.resolve(folder), { timeout: 120000 });
  const smeToLevel = async (pg, l) => { await pg.locator('.view-mode-btn[data-level="' + l + '"]').click({ timeout: T }); await wait(400); };
  const smeOpenDoc = async (pg) => {
    await smeToLevel(pg, "overview");
    if (!(await pg.evaluate(() => document.getElementById("ov-doc").open))) await pg.click("#ov-doc > summary", { timeout: T });
    await wait(200);
  };
  // The Overview as a reader sees it, and where each SME line's parts are.
  const smeRead = (pg) => pg.evaluate(() => {
    const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const lines = [...document.querySelectorAll("#ov-doc .ov-sme")].map((l) => {
      const box = l.getBoundingClientRect();
      const tb = l.querySelector(".ov-sme-text").getBoundingClientRect();
      const btns = [...l.querySelectorAll("button")];
      const rects = btns.map((b) => b.getBoundingClientRect());
      const cell = l.closest(".ov-doc-cell").getBoundingClientRect();
      return {
        key: l.dataset.sme, text: l.querySelector(".ov-sme-text").textContent,
        buttons: btns.map((b) => [b.textContent.trim(), b.title]),
        inside: rects.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5),
        overlap: rects.some((r) => hit(r, tb)) || (rects.length === 2 && hit(rects[0], rects[1])),
        fits: box.right <= cell.right + 0.5 && l.scrollWidth <= l.clientWidth + 1 && box.width > 0,
      };
    });
    return {
      lines,
      from: [...document.querySelectorAll("#ov-doc .ov-sme-from")].map((e) => [e.dataset.smeFrom, e.textContent]),
      status: ((document.getElementById("ov-doc-status") || {}).textContent || "").trim(),
      missing: [...document.querySelectorAll("#ov-summary .ov-sme-missing")].map((e) => e.textContent.trim()),
      att: [...document.querySelectorAll("#ov-attach .att-row")].map((r) => [(r.querySelector(".att-file") || {}).textContent || "",
        (r.querySelector(".att-from") || {}).textContent || ""]),
      noPageScroll: document.documentElement.scrollWidth <= innerWidth,
      fields: Object.fromEntries(["trigger", "result", "exceptions", "effort"].map((k) => [k, (document.querySelector('#ov-doc [data-doc="' + k + '"]') || {}).value])),
    };
  });
  const smeUndo = async (pg) => {
    await pg.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    await pg.keyboard.press("Control+z");
  };
  const smeWaitDisk = async (pred) => {
    for (let k = 0; k < 80; k++) {
      try { if (pred(smeAnno(SME_PROJECT))) return true; } catch (_) { /* mid-write */ }
      await wait(125);
    }
    return false;
  };
  const smeDoc = (a, k) => ((a.document || {})[k] || "");
  let smeZip = null;
  if (!sme.err) {
    let app6, page6, close6;
    try {
      ({ app: app6, page: page6, close: close6 } = await launch(SME_PROJECT, pageErrors));
      await smeSettled(page6, SME_PROJECT);
      await app6.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; });
      // Item 2: the two files in the folder are taken once, from the SME, on the whole project.
      const a0 = smeAnno(SME_PROJECT);
      sme.adopted = smeOfAnno(a0).map((x) => [x.file, x.label, x.step_id, x.added_at, typeof x.id === "string" && x.id.length > 8]);
      sme.adoptedKey = a0.sme_files_adopted;
      sme.undoAfterOpen = await page6.evaluate(() => document.getElementById("btn-undo").getAttribute("aria-disabled"));
      await smeToLevel(page6, "flow");
      await page6.click("#tp-tab-files", { timeout: T });
      await wait(300);
      sme.files = await page6.evaluate(() => [...document.querySelectorAll("#tp-files .tp-file-row")].map((r) =>
        [r.querySelector(".tp-text").textContent.trim(), r.querySelector(".tp-meta").textContent.trim()]));
      // Item 1: the answers under their fields.
      await smeOpenDoc(page6);
      await page6.locator('#ov-doc [data-doc-cell="trigger"]').scrollIntoViewIfNeeded();
      sme.first = await smeRead(page6);
      await page6.screenshot({ path: path.join(OUT, "overview-sme-" + SIZE + ".png") });
      // Use on an empty Trigger writes it; Ctrl+Z takes it back and the line returns.
      await page6.click('#ov-doc .ov-sme[data-sme="trigger"] [data-sme-act="use"]', { timeout: T });
      sme.usedOnDisk = await smeWaitDisk((a) => smeDoc(a, "trigger") === SME_ANSWERS.trigger &&
        (a.sme_answers_dismissed || []).includes("trigger"));
      await wait(300);
      sme.noAsk = await page6.evaluate(() => !document.querySelector(".modal-confirm"));
      sme.used = await smeRead(page6);
      // The analyst edits the field: the answer's line stays gone.
      const EDITED = SME_ANSWERS.trigger + ", or a call to the order desk";
      await page6.locator('#ov-doc [data-doc="trigger"]').fill(EDITED, { timeout: T });
      await page6.locator('#ov-doc [data-doc="trigger"]').press("Tab");
      sme.editedOnDisk = await smeWaitDisk((a) => smeDoc(a, "trigger") === EDITED);
      await wait(400);
      sme.edited = await smeRead(page6);
      // Ctrl+Z takes the edit back (the answer, still used); Ctrl+Z again takes
      // Use back: the field's old text and the answer's line, in one step.
      await smeUndo(page6);
      sme.undo1OnDisk = await smeWaitDisk((a) => smeDoc(a, "trigger") === SME_ANSWERS.trigger);
      await wait(400);
      sme.undo1 = await smeRead(page6);
      await smeUndo(page6);
      sme.undoneOnDisk = await smeWaitDisk((a) => smeDoc(a, "trigger") === "" && !(a.sme_answers_dismissed || []).includes("trigger"));
      await wait(400);
      sme.undoToast = await page6.evaluate(() => ((document.getElementById("toast") || {}).textContent || "").trim());
      sme.undone = await smeRead(page6);
      // Use on a field that holds other text asks first; Cancel keeps it, Replace writes.
      await page6.locator('#ov-doc [data-doc="result"]').fill("What the analyst typed", { timeout: T });
      await page6.locator('#ov-doc [data-doc="result"]').press("Tab");
      await smeWaitDisk((a) => smeDoc(a, "result") === "What the analyst typed");
      await page6.click('#ov-doc .ov-sme[data-sme="result"] [data-sme-act="use"]', { timeout: T });
      await page6.waitForSelector(".modal-confirm", { timeout: T });
      sme.ask = await page6.evaluate(() => {
        const d = document.querySelector(".modal-confirm");
        return { title: d.querySelector("h2").textContent, msg: (d.querySelector(".modal-msg") || {}).textContent,
          detail: (d.querySelector(".modal-detail") || {}).textContent, ok: d.querySelector(".modal-ok").textContent };
      });
      await page6.click(".modal-confirm .modal-cancel", { timeout: T });
      await page6.waitForSelector(".modal-confirm", { state: "detached", timeout: T });
      await wait(300);
      sme.cancelKept = smeDoc(smeAnno(SME_PROJECT), "result") === "What the analyst typed";
      await page6.click('#ov-doc .ov-sme[data-sme="result"] [data-sme-act="use"]', { timeout: T });
      await page6.waitForSelector(".modal-confirm", { timeout: T });
      await page6.click(".modal-confirm .modal-ok", { timeout: T });
      sme.replaced = await smeWaitDisk((a) => smeDoc(a, "result") === SME_ANSWERS.result);
      // Dismiss on Exceptions hides it; Ctrl+Z brings it back.
      await wait(300);
      await page6.click('#ov-doc .ov-sme[data-sme="exceptions"] [data-sme-act="dismiss"]', { timeout: T });
      sme.dismissedOnDisk = await smeWaitDisk((a) => (a.sme_answers_dismissed || []).includes("exceptions"));
      await wait(400);
      sme.dismissed = await smeRead(page6);
      await smeUndo(page6);
      sme.backOnDisk = await smeWaitDisk((a) => !(a.sme_answers_dismissed || []).includes("exceptions"));
      await wait(400);
      sme.back = await smeRead(page6);
      // At 125% zoom (app-zoom.js) the lines still hold.
      await page6.evaluate(() => document.activeElement && document.activeElement.blur());
      await page6.keyboard.press("Control+=");
      await page6.keyboard.press("Control+=");
      await wait(600);
      sme.zoom = await page6.evaluate(() => require("electron").webFrame.getZoomFactor());
      await page6.evaluate(() => document.querySelector('#ov-doc [data-doc-cell="trigger"]').scrollIntoView({ block: "center" }));
      await wait(300);
      sme.at125 = await smeRead(page6);
      // The window as drawn (Playwright's own picture crops a zoomed page to its CSS size).
      const png125 = await app6.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
      fs.writeFileSync(path.join(OUT, "overview-sme-125-" + SIZE + ".png"), Buffer.from(png125, "base64"));
      await page6.keyboard.press("Control+0");
      await wait(400);
      // Use Trigger again, then hand off: the PDD and the zip.
      await page6.click('#ov-doc .ov-sme[data-sme="trigger"] [data-sme-act="use"]', { timeout: T });
      await smeWaitDisk((a) => smeDoc(a, "trigger") === SME_ANSWERS.trigger);
      await wait(300);
      await page6.click("#btn-session-export-menu");
      await page6.waitForSelector("#btn-session-handoff", { state: "visible", timeout: T });
      await page6.click("#btn-session-handoff");
      await page6.waitForSelector(".modal-backdrop.modal-prompt", { timeout: T });
      await page6.click(".modal-backdrop.modal-prompt .modal-ok", { timeout: T });
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline && !smeZip) {
        const z = fs.readdirSync(SME_BASE).find((n) => / v1\.zip$/.test(n));
        if (z) {
          try {
            const buf = fs.readFileSync(path.join(SME_BASE, z));
            if (buf.length > 1000 && zipNames(buf).length) smeZip = { name: z, buf };
          } catch (_) { /* still being written */ }
        }
        if (!smeZip) await wait(500);
      }
      await wait(1000);
      sme.beforeAgain = fs.statSync(smeAnnoPath(SME_PROJECT)).mtimeMs;
      sme.countBefore = smeOfAnno(smeAnno(SME_PROJECT)).length;
    } catch (e) { logActionError("C24 SME", e); sme.err = String(e.message).split("\n")[0]; if (page6) await shot(page6, "fail-overview-sme.png"); }
    if (close6) await close6();
  }
  if (smeZip) {
    const names = zipNames(smeZip.buf);
    const pddName = names.find((n) => !n.includes("/") && / v1 PDD\.docx$/.test(n));
    // The files under the project's attachments/ (not the folder's own entry).
    sme.zipFiles = names.filter((n) => /\/attachments\/[^/]+$/.test(n)).map((n) => n.split("/").pop()).sort();
    if (pddName) {
      const xml = readZipEntry(readZipBuf(smeZip.buf, pddName), "word/document.xml");
      const text = docxText(xml);
      sme.pddTrigger = text.includes("2.3 Trigger" + SME_ANSWERS.trigger);
      sme.pddWho = docxTables(xml).some((t) => t.some((r) => r[0] === "Recorded by" && r[1] === SME_WHO));
      const at = text.lastIndexOf("Attachments");
      sme.pddAttach = at >= 0 && text.slice(at).includes("Order 10900.msg") && text.slice(at).includes("Price list 2026.xlsx") &&
        !text.slice(at).includes("Delivery note.pdf");
    }
  }
  const smeL = (r, k) => r && r.lines.find((l) => l.key === k);
  const smeKeys = (r) => (r ? r.lines.map((l) => l.key) : null);
  record("(sme) C24 item 2: the SME's two files in the folder are attachments of the whole project once, from the SME, " +
    "in a save not on the undo stack; the Files tab says From the SME · On the whole project",
    !sme.err && same(sme.adopted, [["Order 10900.msg", "Order 10900.msg", null, "2026-11-12T09:00:00.000Z", true],
      ["Price list 2026.xlsx", "Price list 2026.xlsx", null, "2026-11-12T09:01:00.000Z", true]]) &&
      same(sme.adoptedKey, ["Order 10900.msg", "Price list 2026.xlsx"]) && sme.undoAfterOpen === "true" &&
      same(sme.files, [["Order 10900.msg", "From the SME · On the whole project"], ["Price list 2026.xlsx", "From the SME · On the whole project"]]),
    JSON.stringify({ adopted: sme.adopted, key: sme.adoptedKey, undo: sme.undoAfterOpen, files: sme.files, err: sme.err }));
  record("(sme) the Overview's attachments say From the SME, and the file not in the folder is said once",
    !sme.err && sme.first && same(sme.first.att, [["Order 10900.msg", "From the SME"], ["Price list 2026.xlsx", "From the SME"]]) &&
      same(sme.first.missing, ["⚠ The SME's file Delivery note.pdf is not in the project folder."]),
    JSON.stringify(sme.first && { att: sme.first.att, missing: sme.first.missing }));
  record("(sme) C24 item 1: the four answers wait under Trigger, Result, Exceptions and Volume and effort as text, each with Use and Dismiss " +
    "and their tooltips; the document's line counts them; at " + SIZE + " nothing overlaps or is cut, and the page does not scroll sideways",
    !sme.err && sme.first && same(smeKeys(sme.first), ["trigger", "result", "exceptions", "effort"]) &&
      smeL(sme.first, "trigger").text === "The SME wrote: " + SME_ANSWERS.trigger &&
      sme.first.lines.every((l) => same(l.buttons, [["Use", "Writes the SME's answer into this field."],
        ["Dismiss", "Hides the SME's answer for this field. Ctrl+Z brings it back."]]) && l.inside && !l.overlap && l.fits) &&
      sme.first.noPageScroll && / The SME answered 4 questions: each waits under its field\.$/.test(sme.first.status),
    JSON.stringify(sme.first && { lines: sme.first.lines, status: sme.first.status, noPageScroll: sme.first.noPageScroll }));
  record("(sme) Use on an empty Trigger writes the answer without a question and dismisses its key (the field and annotations.json), " +
    "the line says it was written from it; the field edited, the answer's line stays gone and so does Written from; " +
    "Ctrl+Z takes the edit back, a second Ctrl+Z takes Use back (Undone: edit document field Trigger): the old text and the line return",
    !sme.err && sme.usedOnDisk && sme.noAsk && sme.used && sme.used.fields.trigger === SME_ANSWERS.trigger && !smeL(sme.used, "trigger") &&
      same(sme.used.from, [["trigger", "Written from the SME's answer."]]) && /The SME answered 3 questions/.test(sme.used.status) &&
      sme.editedOnDisk && sme.edited && !smeL(sme.edited, "trigger") && same(sme.edited.from, []) &&
      sme.undo1OnDisk && sme.undo1 && sme.undo1.fields.trigger === SME_ANSWERS.trigger && !smeL(sme.undo1, "trigger") &&
      same(sme.undo1.from, [["trigger", "Written from the SME's answer."]]) &&
      sme.undoneOnDisk && sme.undone && sme.undone.fields.trigger === "" && !!smeL(sme.undone, "trigger") && same(sme.undone.from, []) &&
      /Undone: edit document field Trigger/.test(sme.undoToast || ""),
    JSON.stringify({ used: sme.used && [sme.used.fields.trigger, smeKeys(sme.used), sme.used.from, sme.used.status],
      edited: sme.edited && [sme.edited.fields.trigger, smeKeys(sme.edited), sme.edited.from],
      undo1: sme.undo1 && [sme.undo1.fields.trigger, smeKeys(sme.undo1), sme.undo1.from],
      undone: sme.undone && [sme.undone.fields.trigger, smeKeys(sme.undone)], toast: sme.undoToast,
      disk: [sme.usedOnDisk, sme.editedOnDisk, sme.undo1OnDisk, sme.undoneOnDisk] }));
  record("(sme) Use on a field that holds other text asks \"Replace what the field holds with the SME's answer?\" (OK Replace); Cancel keeps the text, Replace writes the answer",
    !sme.err && sme.ask && sme.ask.title === "Use the SME's answer" && sme.ask.msg === "Replace what the field holds with the SME's answer?" &&
      sme.ask.ok === "Replace" && sme.cancelKept && sme.replaced,
    JSON.stringify({ ask: sme.ask, kept: sme.cancelKept, replaced: sme.replaced }));
  record("(sme) Dismiss on Exceptions hides its line (annotations.sme_answers_dismissed); Ctrl+Z brings it back",
    !sme.err && sme.dismissedOnDisk && sme.dismissed && !smeL(sme.dismissed, "exceptions") && !!smeL(sme.dismissed, "effort") &&
      sme.backOnDisk && sme.back && !!smeL(sme.back, "exceptions"),
    JSON.stringify({ dismissed: smeKeys(sme.dismissed), back: smeKeys(sme.back), disk: [sme.dismissedOnDisk, sme.backOnDisk] }));
  record("(sme) at 125% zoom the SME's lines hold at " + SIZE + ": nothing overlaps, nothing is cut, no sideways scroll",
    !sme.err && Math.abs((sme.zoom || 0) - 1.25) < 0.001 && sme.at125 && sme.at125.lines.length >= 2 &&
      sme.at125.lines.every((l) => l.inside && !l.overlap && l.fits) && sme.at125.noPageScroll,
    JSON.stringify({ zoom: sme.zoom, lines: sme.at125 && sme.at125.lines.map((l) => [l.key, l.inside, l.overlap, l.fits]), scroll: sme.at125 && sme.at125.noPageScroll }));
  record("(sme) the hand-off's PDD reads the SME's Trigger, lists the two files under Attachments and says Recorded by " + SME_WHO +
    "; the zip carries both files",
    !sme.err && !!smeZip && sme.pddTrigger && sme.pddAttach && sme.pddWho && same(sme.zipFiles, ["Order 10900.msg", "Price list 2026.xlsx"]),
    JSON.stringify({ zip: smeZip && smeZip.name, trigger: sme.pddTrigger, attach: sme.pddAttach, who: sme.pddWho, files: sme.zipFiles }));

  // Launch 7: the same project opened again adds nothing (and writes nothing).
  const again = {};
  if (!sme.err) {
    try {
      const { page: page7, close: close7 } = await launch(SME_PROJECT, pageErrors);
      try {
        await smeSettled(page7, SME_PROJECT);
        await wait(800);
        again.count = smeOfAnno(smeAnno(SME_PROJECT)).length;
        again.mtime = fs.statSync(smeAnnoPath(SME_PROJECT)).mtimeMs;
        again.files = fs.readdirSync(path.join(SME_PROJECT, "attachments")).sort();
      } finally { await close7(); }
    } catch (e) { again.err = String(e.message).split("\n")[0]; }
  }
  record("(sme) opened again, nothing is added twice: the same two attachments from the SME, annotations.json not written",
    !sme.err && !again.err && sme.countBefore === 2 && again.count === 2 && again.mtime === sme.beforeAgain &&
      same(again.files, ["Order 10900.msg", "Price list 2026.xlsx"]),
    JSON.stringify({ before: sme.countBefore, after: again.count, written: again.mtime !== sme.beforeAgain, files: again.files, err: again.err }));

  // Launch 8: a hand-off unzipped by hand, never opened before: read only.
  const ro = {};
  if (!sme.err) {
    try {
      const before = fs.readFileSync(smeAnnoPath(SME_RO), "utf-8");
      const { page: page8, close: close8 } = await launch(SME_RO, pageErrors);
      try {
        await smeSettled(page8, SME_RO);
        ro.readOnly = await page8.evaluate(() => !!(require("./state.js").getSession() || {}).readOnly);
        await smeOpenDoc(page8);
        ro.view = await smeRead(page8);
        await smeToLevel(page8, "flow");
        await page8.click("#tp-tab-files", { timeout: T });
        await wait(300);
        ro.files = await page8.evaluate(() => document.querySelectorAll("#tp-files .tp-file-row").length);
        await wait(500);
        ro.same = fs.readFileSync(smeAnnoPath(SME_RO), "utf-8") === before;
      } finally { await close8(); }
    } catch (e) { ro.err = String(e.message).split("\n")[0]; }
  }
  record("(sme) a hand-off opened read only shows the four answers as text with no buttons, adds no file and writes nothing",
    !sme.err && !ro.err && ro.readOnly && ro.view && same(smeKeys(ro.view), ["trigger", "result", "exceptions", "effort"]) &&
      ro.view.lines.every((l) => l.buttons.length === 0) && / The SME answered 4 questions\.$/.test(ro.view.status) &&
      !/each waits/.test(ro.view.status) && ro.files === 0 && ro.same,
    JSON.stringify({ ro: ro.readOnly, keys: smeKeys(ro.view), buttons: ro.view && ro.view.lines.map((l) => l.buttons.length), status: ro.view && ro.view.status,
      files: ro.files, same: ro.same, err: ro.err }));
  try { fs.rmSync(SME_BASE, { recursive: true, force: true }); } catch (_) { /* temp */ }

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
