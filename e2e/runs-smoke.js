"use strict";
/*
 * Runs-and-steps e2e smoke (BA helper cycle, lane L7a; contracts C1 to C4).
 *
 * Launches the REAL viewer on a throwaway profile (launchViewer) against a
 * TEMP copy of the committed demo session sess-2026-0514-0900, re-analyzed
 * with the current pipeline (4 marked runs, 30 drafted steps), and pins the
 * verbs of the Steps level the way an analyst uses them:
 *   - the runs list: 4 runs in time order, run 1 the pattern, open with its
 *     drafted steps (a row carries a chip only where it differs from its
 *     run); "Use as pattern" (the run's right-click menu) and its Ctrl+Z;
 *   - names (C4): a rename of a run-1 draft names the same-key drafts of the
 *     other runs at once (still drafts, name_source "remembered") and lands in
 *     the profile's remembered-names store; a broken store shows an error and
 *     still saves the session rename; the name box suggests the name;
 *   - the draft-fix count (C3, pattern_run.draft_fixes in annotations.json;
 *     the list shows no live counter, P2.9): merge / split / add / hide each
 *     count on the pattern run, renames do not, and Ctrl+Z, Unhide and
 *     deleting an added step take a count back;
 *   - the keyboard: Up / Down / Enter on the open run, and no shortcut acting
 *     on a step the list does not show (RP-12);
 *   - Confirm run: the states, the Confirmed status and the probe line, which
 *     Copy puts on the clipboard;
 *   - Re-analyze (Help, Troubleshooting: the one analysis by hand, AD-22; its
 *     confirm dialog answered and the run awaited, never assumed): the
 *     confirmed and edited steps survive with their names, and re-drafted
 *     steps carry the remembered names (the viewer passed --names);
 *   - item 8: a Start marker inserted from an activity band's menu lands at the
 *     clicked moment, and the Markers list shows local times.
 * Lane L12b adds:
 *   - a merge in the pattern run carries to the same consecutive drafts of
 *     runs 2 to 4 (draft_keys, the pattern step's name), the toast says so in
 *     one line, it is not counted, and ONE Ctrl+Z takes all of it back;
 *   - a draft hidden in the pattern run: the toast offers Hide in all runs,
 *     which hides the same drafts elsewhere (not counted; one Ctrl+Z);
 *   - the differences review against the confirmed pattern run (the demo's
 *     own extra step in run 2 and skipped step in run 3, run 4 identical);
 *   - Reopen run and its Ctrl+Z; Save as this process (the profile's
 *     processes.json) and the toast's Undo;
 *   - a drafted step is hidden, never deleted (no Delete for it, the bulk
 *     button hides), and the hidden drafts survive the analysis;
 *   - the Saved names dialog (opened from the Steps toolbar): its order,
 *     Rename and Forget;
 *   - a SECOND temp copy of the demo, SEEDED with an extra step and a skipped
 *     step in run 4, opened in the same viewer: it is compared with the saved
 *     process (the line, every run's differences), and Stop comparing
 *     compares it with its own pattern run; Forget this saved process (P3.11)
 *     takes it out of processes.json and the toast's Undo brings it back.
 *
 * Writes only into its temp copies and its throwaway profile. Exits 0 when
 * every check passed, 1 on a failed check, 2 when it could not run (no Python
 * with the pipeline dependencies, or no Electron).
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
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  -- " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}
// The first line for the result detail; the whole message (with Playwright's
// call log, which says why an action could not run) is printed above it.
const errText = (e) => { logActionError("runs-smoke", e); return String((e && e.message) || e).split("\n")[0]; };

/* The demo, copied to temp and analyzed with the current pipeline. A missing
   deps-bearing Python is a hard stop (exit 2): every check reads its output. */
function freshSession() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-runs-"));
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) {
    const s = path.join(SRC_SESSION, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
  }
  const bundled = path.join(VIEWER, "python", "python.exe");
  const pys = fs.existsSync(bundled) ? [bundled] : ["python", "python3"];
  for (const py of pys) {
    try {
      execFileSync(py, [path.join(REPO, "normalization", "normalize.py"), tmp, "--mine"], { cwd: REPO, stdio: "ignore" });
      return tmp;
    } catch (_) { /* try the next interpreter */ }
  }
  return null;
}

const SESSION = freshSession();
if (!SESSION) {
  console.log("[runs-e2e] FATAL: no Python with the pipeline dependencies to analyze the demo");
  process.exit(2);
}
const ANNO = path.join(SESSION, "annotations.json");
const STATS = path.join(SESSION, "stats.json");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const _temps = [SESSION];

/* Poll the file on disk until `pred` holds (saves are asynchronous). Returns
   the last value read, whether or not it holds. */
async function waitDisk(p, pred, ms) {
  const deadline = Date.now() + (ms || T);
  let last = null;
  while (Date.now() < deadline) {
    try { last = readJson(p); if (pred(last)) return last; } catch (_) { /* mid-write: read again */ }
    await wait(150);
  }
  return last;
}

/* Run case ids in time order, from the analysis (the same order the view and
   meta.draft_summary use). */
function runIds(statsPath) {
  return (readJson(statsPath || STATS).case_stats || []).filter((c) => !c.parent_case_id)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts) || (a.case_id < b.case_id ? -1 : 1))
    .map((c) => c.case_id);
}
const stepsOf = (anno, caseId) => (anno.steps || []).filter((s) => s.case_id === caseId)
  .sort((a, b) => a.time_range.start.localeCompare(b.time_range.start));

const KEY_SEARCH = "chrome|Salesforce - Account lookup|Button:search";
const KEY_OPEN = "chrome|Salesforce - Account lookup|Button:open-customer-record";
const KEY_SAVE_ORDER = "chrome|Salesforce - Order|Button:save-order";
const KEY_CHECK = "sapgui|va01|MenuItem:check-document";
const KEY_CREATE = "sapgui|va01|Button:create-sales-order";
const KEY_EXCEL = "excel|Excel - Order Tracking.xlsx|Button:save-workbook";
const KEY_OUTLOOK = "outlook|Outlook - Order confirmation|Button:send";
const KEY_NOTEPAD = "notepad|Notepad - Internal mappings.txt|(visit)";
const NAME_SEARCH = "Look up the customer";
const NAME_EXCEL = "Update the order tracker";
const NAME_NOTEPAD = "Look up the plant code";
const MERGED = "va01: Check document + va01: Create sales order";
const PROCESS_NAME = "Order entry";
const isCarried = (s) => s.state === "edited" && !s.draft_key && s.name === MERGED &&
  JSON.stringify(s.draft_keys) === JSON.stringify([KEY_CHECK, KEY_CREATE]);

(async () => {
  const RUNS = runIds();
  const pre = readJson(ANNO);
  const preOk = RUNS.length === 4 && !pre.pattern_run &&
    (pre.steps || []).length > 0 && pre.steps.every((s) => s.state === "auto_suggested" && s.draft_key) &&
    RUNS.map((r) => stepsOf(pre, r).length).join(",") === "7,10,6,7";
  record("precondition: the demo analyzes to 4 runs of drafted steps (7, 10, 6, 7) and no pattern run", preOk,
    "runs=" + RUNS.length + " steps per run=" + RUNS.map((r) => stepsOf(pre, r).length).join(","));
  if (!preOk) process.exit(1);

  let viewer;
  try {
    viewer = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + SESSION], cwd: VIEWER });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const { app, profileDir } = viewer;
  const STORE = path.join(profileDir, "pdt-library", "remembered-names.json");
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  // The window size is launchViewer's (1500x950, or PDT_E2E_WINDOW); no
  // emulated viewport, so the page is exactly what that window shows.
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
  await page.evaluate(() => { const d = document.getElementById("session-summary"); if (d) d.open = false; });
  await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
  await page.waitForSelector("#step-list .run-group", { timeout: T });

  /* ---- page probes ------------------------------------------------------- */
  const runsState = () => page.evaluate(() => [...document.querySelectorAll("#step-list .run-group")].map((g) => ({
    caseId: g.dataset.caseId || null, group: g.dataset.group || null,
    open: g.classList.contains("open"), pattern: g.classList.contains("pattern"),
    title: ((g.querySelector(".run-title") || {}).textContent || "").trim(),
    status: ((g.querySelector(".run-status") || {}).textContent || "").trim(),
    fixes: ((g.querySelector(".run-fixes") || {}).textContent || "").trim(),
    probe: ((g.querySelector(".run-probe-text") || {}).textContent || "").trim(),
    meta: ((g.querySelector(".run-meta") || {}).textContent || "").trim(),
    diffs: [...g.querySelectorAll(".run-diffs li")].map((li) => li.textContent.trim()),
    acts: [...g.querySelectorAll(".run-actions > button")].map((b) => b.dataset.act),
    showHidden: (() => { const cb = g.querySelector('[data-act="show-hidden"]'); return cb ? { checked: cb.checked, label: (cb.parentElement.textContent || "").trim() } : null; })(),
    rows: [...g.querySelectorAll(".step-row")].map((r) => ({
      id: r.dataset.stepId, state: r.dataset.state,
      name: ((r.querySelector(".step-name") || {}).textContent || "").trim(),
      chip: ((r.querySelector(".step-chip") || {}).textContent || "").trim(),
      remembered: !!r.querySelector(".step-remembered"),
      selected: r.classList.contains("selected"),
    })),
  })));
  const group = async (caseId) => (await runsState()).find((g) => g.caseId === caseId) || null;
  const groupSel = (caseId) => '#step-list .run-group[data-case-id="' + caseId + '"]';
  async function openRun(caseId) {
    const g = await group(caseId);
    if (g && g.open) return;
    await page.locator(groupSel(caseId) + " > .run-row").click({ timeout: T });
    await page.waitForFunction((sel) => { const g = document.querySelector(sel); return !!(g && g.classList.contains("open")); },
      groupSel(caseId), { timeout: T });
  }
  const rowByName = (caseId, name) => page.locator(groupSel(caseId) + " .step-row").filter({
    has: page.locator(".step-name", { hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }),
  });
  const rowById = (id) => page.locator('#step-list .step-row[data-step-id="' + id + '"]');
  // P2.9: the list shows no live fix counter; the count is the pattern run's
  // record in annotations.json (what the probe line reads once it is
  // confirmed). No record yet reads as zero fixes.
  const fixesOnDisk = () => {
    const pr = readJson(ANNO).pattern_run;
    return JSON.stringify((pr && pr.draft_fixes) || { merge: 0, split: 0, add: 0, drop: 0 });
  };
  const fx = (merge, split, add, drop) => JSON.stringify({ merge, split, add, drop });
  const waitFixes = async (want) => {
    const deadline = Date.now() + T;
    let got = null;
    while (Date.now() < deadline) {
      try { got = fixesOnDisk(); if (got === want) return; } catch (_) { /* mid-write: read again */ }
      await wait(150);
    }
    throw new Error("draft_fixes stayed " + got + ", expected " + want);
  };
  const waitRows = (caseId, n) => page.waitForFunction(([sel, k]) =>
    document.querySelectorAll(sel + " .step-row").length === k, [groupSel(caseId), n], { timeout: T });
  const toastText = () => page.$eval("#toast", (el) => ({ text: el.textContent || "", error: el.className.includes("error") }));
  // Wait until the toast shows `re` (a toast is transient: read it while it shows).
  const waitToast = (re) => page.waitForFunction((src) => {
    const el = document.getElementById("toast");
    return !!(el && el.classList.contains("show") && new RegExp(src).test(el.textContent || ""));
  }, re.source, { timeout: T });
  const metaDiffs = (meta) => (/ · (no differences|\d+ differences?)$/.exec(meta || "") || [])[1] || null;
  const FIX0 = fx(0, 0, 0, 0);
  const [R1, R2, R3, R4] = RUNS;

  // ---- 1. the runs list ----------------------------------------------------
  {
    const st = await runsState();
    const r1 = st[0] || {};
    const ok = st.length === 4 && st.map((g) => g.caseId).join() === RUNS.join() &&
      st.map((g) => g.title).join() === "Run 1,Run 2,Run 3,Run 4" &&
      r1.pattern && st.filter((g) => g.pattern).length === 1 && r1.open && st.filter((g) => g.open).length === 1 &&
      r1.rows.length === 7 && r1.rows.every((r) => r.chip === "") && st.every((g) => g.status === "Draft") &&
      r1.fixes === "" && !r1.acts.includes("use-pattern");
    record("Steps shows the 4 runs in time order; run 1 is the pattern, open with its 7 drafted steps (no chip on a row that matches its Draft run, no live fix counter)", ok,
      JSON.stringify(st.map((g) => ({ t: g.title, pattern: g.pattern, open: g.open, status: g.status, rows: g.rows.length, fixes: g.fixes }))));
    if (!ok) await shot(page, "fail-runs-list.png");
  }

  // ---- 2. a broken store: an error, and the session rename is still saved ----
  {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, "{ this is not a names file");
    const before = fs.readFileSync(STORE);
    let err = null, toast = null;
    try {
      await openRun(R2);
      // By id: once the rename input opens, the name no longer matches.
      const row = rowById(await rowByName(R2, "Notepad - Internal mappings.txt").getAttribute("data-step-id", { timeout: T }));
      await row.locator(".step-name").dblclick({ timeout: T });
      const input = row.locator(".step-name-edit");
      await input.fill(NAME_NOTEPAD, { timeout: T });
      await input.press("Enter");
      await page.waitForFunction(() => /could not be remembered/.test((document.getElementById("toast") || {}).textContent || ""),
        null, { timeout: T });
      toast = await toastText();
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => stepsOf(a, R2).some((s) => s.draft_key === KEY_NOTEPAD && s.name === NAME_NOTEPAD));
    const saved = stepsOf(disk, R2).find((s) => s.draft_key === KEY_NOTEPAD) || {};
    const storeKept = fs.readFileSync(STORE).equals(before);
    const ok = !err && toast && toast.error && saved.name === NAME_NOTEPAD && saved.state === "edited" && storeKept;
    record("C4: a remembered-names store that cannot be read shows an error, is left as it is, and the session rename is still saved",
      ok, JSON.stringify({ err, toast: toast && toast.text.slice(0, 160), saved: { name: saved.name, state: saved.state }, storeKept }));
    if (!ok) await shot(page, "fail-runs-store-error.png");
    fs.rmSync(STORE, { force: true });
  }

  // ---- 3. Use as pattern and its inverse (Ctrl+Z) ----------------------------
  {
    let err = null, moved = null, back = null, diskMoved = null, diskBack = null;
    try {
      await openRun(R3);
      moved = { buttonOnRun: (await group(R3)).acts.includes("use-pattern") };
      await page.locator(groupSel(R3) + " > .run-row").click({ button: "right", timeout: T });
      await page.locator('#run-ctx-menu [data-act="use-pattern"]').click({ timeout: T });
      await page.waitForFunction((sel) => document.querySelector(sel).classList.contains("pattern"), groupSel(R3), { timeout: T });
      moved.pattern = (await runsState()).filter((g) => g.pattern).map((g) => g.caseId);
      diskMoved = (await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.case_id === R3)).pattern_run;
      await page.keyboard.press("Control+z");
      await page.waitForFunction((sel) => document.querySelector(sel).classList.contains("pattern"), groupSel(R1), { timeout: T });
      back = (await runsState()).filter((g) => g.pattern).map((g) => g.caseId);
      diskBack = (await waitDisk(ANNO, (a) => !a.pattern_run)).pattern_run;
    } catch (e) { err = errText(e); }
    const ok = !err && moved && moved.buttonOnRun === false && JSON.stringify(moved.pattern) === JSON.stringify([R3]) &&
      diskMoved && diskMoved.case_id === R3 &&
      diskMoved.confirmed_at === null && diskMoved.drafted_steps === 6 &&
      JSON.stringify(diskMoved.draft_fixes) === JSON.stringify({ merge: 0, split: 0, add: 0, drop: 0 }) &&
      JSON.stringify(back) === JSON.stringify([R1]) && diskBack === undefined;
    record("C3 + P3.8: Use as pattern (the run's right-click menu, no button on the open run) makes run 3 the pattern (pattern_run written); Ctrl+Z makes run 1 the pattern again",
      ok, JSON.stringify({ err, moved, diskMoved, back, diskBack }));
    if (!ok) await shot(page, "fail-runs-use-pattern.png");
  }

  // ---- 4. rename a run-1 draft: remembered, and named in runs 2 to 4 at once --
  let searchIds = {};
  {
    let err = null;
    try {
      await openRun(R1);
      await rowByName(R1, "Salesforce - Account lookup: Search").click({ timeout: T });
      await page.locator("#step-name").fill(NAME_SEARCH, { timeout: T });
      await page.locator("#btn-step-save").click({ timeout: T });
      await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")].some((e) => e.textContent.trim() === n),
        NAME_SEARCH, { timeout: T });
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => RUNS.slice(1).every((r) => stepsOf(a, r).some((s) => s.draft_key === KEY_SEARCH && s.name === NAME_SEARCH)));
    const per = RUNS.map((r) => stepsOf(disk, r).find((s) => s.draft_key === KEY_SEARCH) || {});
    searchIds = Object.fromEntries(RUNS.map((r, i) => [r, per[i].step_id]));
    const store = fs.existsSync(STORE) ? readJson(STORE) : null;
    const entry = store && store.names && store.names[KEY_SEARCH];
    const ok = !err && per[0].name === NAME_SEARCH && per[0].state === "edited" &&
      per.slice(1).every((s) => s.name === NAME_SEARCH && s.state === "auto_suggested" && s.name_source === "remembered") &&
      store && store.version === 1 && entry && entry.name === NAME_SEARCH && typeof entry.updated_at === "string";
    record("C4: renaming a run-1 draft names the same-key drafts of runs 2 to 4 at once (still drafts, name_source remembered) and writes the store in the profile",
      ok, JSON.stringify({ err, per: per.map((s) => [s.state, s.name, s.name_source]), store }));

    await openRun(R2);
    const g2 = await group(R2);
    const row2 = g2.rows.find((r) => r.id === searchIds[R2]) || {};
    const ok2 = row2.name === NAME_SEARCH && row2.chip === "" && row2.remembered;
    record("C4: run 2 shows the new name on its draft right away (remembered tag; no chip, it matches its Draft run), without a re-analysis",
      ok2, JSON.stringify(row2));
    if (!(ok && ok2)) await shot(page, "fail-runs-rename.png");

    // Item 6: the name box suggests the remembered name and the session's names.
    let sugg = null;
    try {
      await rowByName(R2, "Salesforce - Order: Save order").click({ timeout: T });
      await page.waitForSelector("#step-name", { timeout: T });
      sugg = await page.evaluate(() => {
        const input = document.getElementById("step-name");
        const dl = document.getElementById(input.getAttribute("list") || "");
        return { list: input.getAttribute("list"), options: dl ? [...dl.querySelectorAll("option")].map((o) => o.value) : null };
      });
    } catch (e) { sugg = { err: errText(e) }; }
    const ok3 = !!(sugg && sugg.options && sugg.options[0] === NAME_SEARCH && sugg.options.includes("va01: Check document"));
    record("item 6: the name box suggests the remembered name first (same app) and the names used in the session",
      ok3, JSON.stringify(sugg && { list: sugg.list, first: sugg.options && sugg.options.slice(0, 4), n: sugg.options && sugg.options.length, err: sugg.err }));
  }

  // ---- 5. the draft-fix counter (C3) ------------------------------------------
  {
    await openRun(R1);
    record("C3: renames are not counted (the pattern run's record still reads 0 fixes)", fixesOnDisk() === FIX0, fixesOnDisk());

    // Merge with next (right-click menu).
    let err = null, disk = null, mergeToast = null, menuItems = null;
    try {
      await rowByName(R1, "va01: Check document").click({ button: "right", timeout: T });
      await page.waitForSelector("#step-ctx-menu", { timeout: T });
      menuItems = await page.$$eval("#step-ctx-menu > div", (els) => els.map((d) => (d.textContent || "").trim()).filter(Boolean));
      await page.locator("#step-ctx-menu div", { hasText: /^Merge with next$/ }).click({ timeout: T });
      await waitToast(/Merged here and in/);
      mergeToast = (await toastText()).text;
      await waitRows(R1, 6);
      await waitFixes(fx(1, 0, 0, 0));
      disk = await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.draft_fixes && a.pattern_run.draft_fixes.merge === 1);
    } catch (e) { err = errText(e); }
    const g = await group(R1);
    const merged = g.rows.find((r) => r.name === MERGED);
    const pr = disk && disk.pattern_run;
    const ok = !err && merged && merged.chip === "Edited" && pr && pr.case_id === R1 && pr.confirmed_at === null &&
      pr.drafted_steps === 7 && JSON.stringify(pr.draft_fixes) === JSON.stringify({ merge: 1, split: 0, add: 0, drop: 0 });
    record("C3: Merge with next on the pattern run counts one merge (pattern_run written: run 1, drafted_steps 7)",
      ok, JSON.stringify({ err, merged, pattern_run: pr, fixes: g.fixes }));
    if (!ok) await shot(page, "fail-runs-merge.png");
    // L12b item 6: the step menu offers no automation-candidate flag (ADR-0027);
    // waste is its one flag, and its take-out item for a draft reads Hide step.
    const okMenu = !!menuItems && !menuItems.some((t) => /automation/i.test(t)) &&
      menuItems.includes("Flag as waste") && menuItems.includes("Hide step") && menuItems.includes("Merge with next");
    record("L12b item 6: the step menu has no automation-candidate item; Flag as waste is its one flag and a draft's take-out item reads Hide step",
      okMenu, JSON.stringify(menuItems));

    // L12b items 1 and 2: the merged step keeps its members' keys, and the merge
    // carries to runs 2 to 4 (run 2 does the pair twice), named like the pattern
    // step; the one-line toast says so; the carried merges are not counted.
    const carried = RUNS.map((r) => stepsOf(disk || { steps: [] }, r));
    const st = await runsState();
    const metaOf = (c) => (st.find((x) => x.caseId === c) || {}).meta || "";
    const leftover = carried.flat().filter((s) => s.draft_key === KEY_CHECK || s.draft_key === KEY_CREATE);
    const okCarry = !err && isCarried(carried[0].find((s) => s.name === MERGED) || {}) &&
      carried.map((l) => l.filter(isCarried).length).join() === "1,2,1,1" &&
      carried.map((l) => l.length).join() === "6,8,5,6" && leftover.length === 0 &&
      [R2, R3, R4].map(metaOf).map((m) => m.split(" · ")[0]).join() === "8 steps,5 steps,6 steps" &&
      mergeToast === "Merged here and in 3 other runs. Ctrl+Z undoes it.";
    record("L12b items 1-2: the pattern merge keeps draft_keys and carries to the same drafts of runs 2 to 4 (run 2 twice), named like the pattern step, not counted; the toast says \"Merged here and in 3 other runs\"",
      okCarry, JSON.stringify({ err, toast: mergeToast, carriedPerRun: carried.map((l) => l.filter(isCarried).length),
        stepsPerRun: carried.map((l) => l.length), leftover: leftover.length, metas: [R2, R3, R4].map(metaOf) }));
    if (!okCarry) await shot(page, "fail-runs-carry.png");

    // ONE Ctrl+Z takes the merge, its count and every carried merge back; Ctrl+Y
    // brings all of it back.
    let err2 = null, undone = null, redone = null;
    try {
      await page.keyboard.press("Control+z");
      await waitRows(R1, 7);
      await waitFixes(FIX0);
      undone = await waitDisk(ANNO, (a) => RUNS.map((r) => stepsOf(a, r).length).join() === "7,10,6,7");
      await page.keyboard.press("Control+y");
      await waitRows(R1, 6);
      await waitFixes(fx(1, 0, 0, 0));
      redone = await waitDisk(ANNO, (a) => RUNS.map((r) => stepsOf(a, r).length).join() === "6,8,5,6");
    } catch (e) { err2 = errText(e); }
    const undoneClean = !!undone && RUNS.map((r) => stepsOf(undone, r).length).join() === "7,10,6,7" &&
      undone.steps.every((s) => s.draft_key && !s.draft_keys) &&
      undone.steps.filter((s) => s.draft_key === KEY_CHECK || s.draft_key === KEY_CREATE).length === 10 &&
      undone.steps.filter((s) => s.draft_key === KEY_CHECK || s.draft_key === KEY_CREATE).every((s) => s.state === "auto_suggested");
    const redoneAll = !!redone && RUNS.map((r) => stepsOf(redone, r).filter(isCarried).length).join() === "1,2,1,1";
    record("C3 + L12b: ONE Ctrl+Z takes the merge, its count and the 4 carried merges back (every step a draft again); Ctrl+Y brings them all back",
      !err2 && undoneClean && redoneAll, err2 || JSON.stringify({ undoneClean, redoneAll }));

    // S splits the selected (visible) step: a split; Ctrl+Z takes it back.
    let err3 = null;
    try {
      await rowByName(R1, "Excel - Order Tracking.xlsx: Save workbook").click({ timeout: T });
      await page.keyboard.press("s");
      await waitRows(R1, 7);
      await waitFixes(fx(1, 1, 0, 0));
      await page.keyboard.press("Control+z");
      await waitRows(R1, 6);
      await waitFixes(fx(1, 0, 0, 0));
    } catch (e) { err3 = errText(e); }
    record("C3: S splits the selected step and counts a split; Ctrl+Z takes the split and its count back",
      !err3, err3 || "7 rows / split 1, then 6 rows / split 0");

    // Hide a draft (a drop), list it with Show hidden steps, Unhide (drop back).
    let err4 = null, hiddenRow = null;
    const hideAll = { offer: null, done: null, disk: null, fixes: null, undone: null };
    try {
      const outlook = rowByName(R1, "Outlook - Order confirmation: Send");
      const oid = await outlook.getAttribute("data-step-id");
      await outlook.click({ timeout: T });
      await page.locator("#btn-step-hide", { hasText: /^Hide step$/ }).click({ timeout: T });
      await waitRows(R1, 5);
      await waitFixes(fx(1, 0, 0, 1));
      // L12b item 2: the toast offers Hide in all runs (runs 2 and 4 have this
      // draft, run 3 does not); it hides them in one edit, not counted, and
      // one Ctrl+Z shows them again (the pattern hide stays).
      await waitToast(/Hide in all runs/);
      hideAll.offer = (await toastText()).text;
      await page.locator('#toast [data-act="hide-all-runs"]').click({ timeout: T });
      await waitToast(/Hidden here and in/);
      hideAll.done = (await toastText()).text;
      hideAll.disk = await waitDisk(ANNO, (a) => [R2, R4].every((r) => stepsOf(a, r).some((s) => s.draft_key === KEY_OUTLOOK && s.state === "hidden")));
      hideAll.fixes = fixesOnDisk();
      await page.keyboard.press("Control+z");
      hideAll.undone = await waitDisk(ANNO, (a) => [R2, R4].every((r) => stepsOf(a, r).some((s) => s.draft_key === KEY_OUTLOOK && s.state === "auto_suggested")));
      await waitRows(R1, 5);
      const toggle = page.locator(groupSel(R1) + ' [data-act="show-hidden"]');
      await toggle.check({ timeout: T });
      await waitRows(R1, 6);
      hiddenRow = ((await group(R1)).rows.find((r) => r.id === oid)) || null;
      await rowById(oid).click({ timeout: T });
      await page.locator("#btn-step-hide", { hasText: "Unhide" }).click({ timeout: T });
      await waitFixes(fx(1, 0, 0, 0));
      await waitRows(R1, 6);
    } catch (e) { err4 = errText(e); }
    // With nothing hidden any more the switch is gone (no switch that does nothing).
    const noToggle = (await group(R1)).showHidden === null;
    const ok4 = !err4 && hiddenRow && hiddenRow.chip === "Hidden" && hiddenRow.state === "hidden" && noToggle;
    record("C3: hiding a draft counts a drop; Show hidden steps lists it with a Hidden chip; Unhide takes the drop back",
      ok4, err4 || JSON.stringify(hiddenRow));
    const outlookOf = (a, r) => stepsOf(a || { steps: [] }, r).filter((s) => s.draft_key === KEY_OUTLOOK);
    const okAll = !err4 && hideAll.offer === "Step hidden. 2 other runs have the same drafted step.Hide in all runs" &&
      hideAll.done === "Hidden here and in 2 other runs. Ctrl+Z undoes it." &&
      [R2, R4].every((r) => outlookOf(hideAll.disk, r).length === 1 && outlookOf(hideAll.disk, r)[0].state === "hidden" &&
        outlookOf(hideAll.disk, r)[0]._prev_state === "auto_suggested") &&
      outlookOf(hideAll.disk, R3).length === 0 && outlookOf(hideAll.disk, R1)[0].state === "hidden" &&
      hideAll.fixes === fx(1, 0, 0, 1) &&
      [R2, R4].every((r) => outlookOf(hideAll.undone, r)[0].state === "auto_suggested") &&
      outlookOf(hideAll.undone, R1)[0].state === "hidden";
    record("L12b item 2: hiding a pattern draft offers Hide in all runs in its toast; it hides runs 2 and 4's same draft (not counted), and one Ctrl+Z shows them again while the pattern hide stays",
      okAll, JSON.stringify({ err: err4, offer: hideAll.offer, done: hideAll.done, fixes: hideAll.fixes,
        hidden: [R2, R4].map((r) => (outlookOf(hideAll.disk, r)[0] || {}).state), undone: [R2, R4].map((r) => (outlookOf(hideAll.undone, r)[0] || {}).state) }));
    if (!okAll) await shot(page, "fail-runs-hide-all.png");

    // + Add step lands in the open run after the selected step: an add; deleting it takes the add back.
    let err5 = null, added = null, addedDisk = null;
    try {
      await rowById(searchIds[R1]).click({ timeout: T });
      await page.locator("#btn-add-manual-step").click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill("Check the stock", { timeout: T });
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      await waitRows(R1, 7);
      await waitFixes(fx(1, 0, 1, 0));
      const g1 = await group(R1);
      added = { index: g1.rows.findIndex((r) => r.name === "Check the stock"), row: g1.rows.find((r) => r.name === "Check the stock") };
      addedDisk = (await waitDisk(ANNO, (a) => (a.steps || []).some((s) => s.name === "Check the stock")))
        .steps.find((s) => s.name === "Check the stock");
      await page.locator(".step-detail-more > summary").click({ timeout: T });
      await page.locator("#btn-step-delete").click({ timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await waitRows(R1, 6);
      await waitFixes(fx(1, 0, 0, 0));
    } catch (e) { err5 = errText(e); }
    const searchStep = stepsOf(pre, R1)[0];
    const ok5 = !err5 && added && added.index === 1 && added.row.chip === "Added" && addedDisk &&
      addedDisk.case_id === R1 && addedDisk.state === "manually_authored" &&
      addedDisk.time_range.start === new Date(searchStep.time_range.end).toISOString() &&
      Date.parse(addedDisk.time_range.end) <= Date.parse(stepsOf(pre, R1)[1].time_range.start);
    record("C3: + Add step lands in the open run right after the selected step (Added chip, run 1, ends before the next step) and counts an add; deleting it takes the add back",
      ok5, JSON.stringify({ err: err5, added, disk: addedDisk && { case_id: addedDisk.case_id, state: addedDisk.state, time_range: addedDisk.time_range } }));
    if (!(ok4 && ok5)) await shot(page, "fail-runs-fixes.png");
  }

  // ---- 6. the keyboard (item 9): only on what the list shows -----------------
  {
    let err = null, afterMove = null, renaming = null;
    try {
      const g = await group(R1);
      await rowById(g.rows[0].id).click({ timeout: T });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      afterMove = (await group(R1)).rows.findIndex((r) => r.selected);
      await page.keyboard.press("Enter");
      await page.waitForSelector(groupSel(R1) + " .step-row.selected .step-name-edit", { timeout: T });
      renaming = await page.evaluate(() => document.activeElement && document.activeElement.className);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".step-name-edit"), null, { timeout: T });
    } catch (e) { err = errText(e); }
    record("item 9: Up / Down move the selection within the open run; Enter opens the rename of that row",
      !err && afterMove === 2 && renaming === "step-name-edit", JSON.stringify({ err, afterMove, renaming }));

    // A selection the list does not show (a run-3 step while run 1 is open).
    // Each key is checked on its own against the WHOLE run-3 steps: S then M
    // on the same step would split and merge back into the same id and name,
    // so a check of ids and names alone could not see either of them act.
    const run3 = () => JSON.stringify(stepsOf(readJson(ANNO), R3).map((s) =>
      [s.step_id, s.name, s.state, s.draft_key || null, s.time_range, (s.evidence || {}).interaction_event_ids]));
    const hidden3 = stepsOf(readJson(ANNO), R3)[2].step_id;
    await page.evaluate((sid) => {
      require("./state.js").setSelectedStepId(sid);
      require("./views/steps-view.js").renderStepsLevel();
    }, hidden3);
    const visibleRow = await page.$('#step-list .step-row[data-step-id="' + hidden3 + '"]');
    const before = run3();
    await page.keyboard.press("s");
    await wait(1000);
    const afterS = run3();
    await page.keyboard.press("m");
    await wait(1000);
    const afterM = run3();
    record("RP-12: S and M do nothing to a selected step the list does not show (run 3's step while run 1 is open)",
      visibleRow === null && before === afterS && before === afterM,
      "rowShown=" + !!visibleRow + " unchangedAfterS=" + (before === afterS) + " unchangedAfterM=" + (before === afterM));
    await page.evaluate(() => { require("./state.js").setSelectedStepId(null); require("./views/steps-view.js").renderStepsLevel(); });
  }

  // ---- 7. Confirm run and the probe line --------------------------------------
  const PROBE = "Run 1: 7 drafted steps, 1 boundary fix (merge 1, split 0, add 0, hide 0)";
  {
    let err = null;
    try {
      await page.locator(groupSel(R1) + ' [data-act="confirm-run"]').click({ timeout: T });
      await page.waitForFunction((sel) => { const p = document.querySelector(sel + " .run-probe-text"); return !!(p && p.textContent.trim()); },
        groupSel(R1), { timeout: T });
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.confirmed_at);
    const r1 = stepsOf(disk, R1).filter((s) => s.state !== "hidden");
    const states = r1.map((s) => s.state).sort().join(",");
    const g = await group(R1);
    const ok = !err && states === "confirmed,confirmed,confirmed,confirmed,edited,edited" &&
      g.status === "Confirmed" && g.probe === PROBE && !g.fixes &&
      typeof disk.pattern_run.confirmed_at === "string" && !isNaN(Date.parse(disk.pattern_run.confirmed_at)) &&
      JSON.stringify(disk.pattern_run.draft_fixes) === JSON.stringify({ merge: 1, split: 0, add: 0, drop: 0 }) &&
      !(await group(R2)).rows.some((r) => r.state === "confirmed");
    record("C2/C3: Confirm run turns run 1's remaining drafts into confirmed, reads Confirmed, and shows the probe line \"" + PROBE + "\"",
      ok, JSON.stringify({ err, states, status: g.status, probe: g.probe, pattern_run: disk.pattern_run }));
    if (!ok) await shot(page, "fail-runs-confirm.png");
    // P1.9: a row carries a chip only where it differs from its run. In the
    // confirmed run the confirmed rows carry none; the edited ones stand out.
    const chips = (g.rows || []).map((r) => r.state + ":" + r.chip);
    const chipsOk = chips.length === 6 &&
      chips.filter((c) => c === "confirmed:").length === 4 && chips.filter((c) => c === "edited:Edited").length === 2;
    record("P1.9: in the confirmed run only the rows that differ carry a chip (the 2 edited ones), the 4 confirmed ones none",
      chipsOk, JSON.stringify(chips));

    let clip = null;
    try {
      await page.locator(groupSel(R1) + ' [data-act="copy-probe"]').click({ timeout: T });
      await wait(300);
      clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    } catch (e) { clip = "error: " + errText(e); }
    record("C3: Copy puts the probe line on the clipboard", clip === PROBE, JSON.stringify(clip));
    await shot(page, "runs-smoke-confirmed.png");
  }

  // ---- 7b. L12b item 3: the differences review against the pattern run ------
  // The demo's own variants: run 2 visits Notepad (renamed in check 2) between
  // its two carried merges, run 3 never sends the confirmation, run 4 matches.
  {
    const WANT = {
      [R2]: ["Extra step: " + NAME_NOTEPAD + " (after " + MERGED + ")."],
      [R3]: ["Skipped: Outlook - Order confirmation: Send (step 6 of the pattern run)."],
      [R4]: [],
    };
    let err = null;
    const seen = {};
    try {
      for (const r of [R2, R3, R4]) {
        await openRun(r);
        seen[r] = (await group(r)).diffs;
      }
    } catch (e) { err = errText(e); }
    const st = await runsState();
    const metas = RUNS.map((r) => metaDiffs((st.find((g) => g.caseId === r) || {}).meta));
    const ok = !err && [R2, R3, R4].every((r) => JSON.stringify(seen[r]) === JSON.stringify(WANT[r])) &&
      metas.join() === ",1 difference,1 difference,no differences";
    record("L12b item 3: each other run lists its differences from the confirmed pattern run (run 2: an extra step, run 3: a skipped step, run 4: none) and its line counts them",
      ok, JSON.stringify({ err, seen: [R2, R3, R4].map((r) => seen[r]), metas }));
    if (!ok) await shot(page, "fail-runs-differences.png");
    await openRun(R2);
    await shot(page, "runs-smoke-differences.png");
  }

  // ---- 7c. L12b item 4: Reopen run, the inverse of Confirm run ------------------
  {
    let err = null, g = null, disk = null, back = null, gBack = null;
    try {
      await openRun(R1);
      await page.locator(groupSel(R1) + ' [data-act="reopen-run"]').click({ timeout: T });
      disk = await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.confirmed_at === null);
      await page.waitForFunction((sel) => !document.querySelector(sel + " .run-probe-text") &&
        ((document.querySelector(sel + " .run-status") || {}).textContent || "").trim() === "Draft",
      groupSel(R1), { timeout: T });
      g = await group(R1);
      await page.keyboard.press("Control+z");
      back = await waitDisk(ANNO, (a) => a.pattern_run && typeof a.pattern_run.confirmed_at === "string");
      await page.waitForSelector(groupSel(R1) + " .run-probe-text", { timeout: T });
      gBack = await group(R1);
    } catch (e) { err = errText(e); }
    const states = (a) => stepsOf(a || { steps: [] }, R1).filter((s) => s.state !== "hidden").map((s) => s.state).sort().join(",");
    const ok = !err && states(disk) === "auto_suggested,auto_suggested,auto_suggested,auto_suggested,edited,edited" &&
      JSON.stringify(disk.pattern_run.draft_fixes) === JSON.stringify({ merge: 1, split: 0, add: 0, drop: 0 }) &&
      g && g.status === "Draft" && !g.probe && g.fixes === "" &&
      g.acts.includes("confirm-run") && !g.acts.includes("reopen-run") && !g.acts.includes("save-process") &&
      states(back) === "confirmed,confirmed,confirmed,confirmed,edited,edited" &&
      gBack && gBack.status === "Confirmed" && gBack.probe === PROBE && gBack.acts.includes("reopen-run");
    record("L12b item 4: Reopen run turns run 1's confirmed steps back into drafts (the edited ones stay), clears confirmed_at, hides the probe line and keeps the count; Ctrl+Z confirms it again",
      ok, JSON.stringify({ err, reopened: states(disk), fixes: g && g.fixes, status: g && g.status, acts: g && g.acts,
        back: states(back), probeBack: gBack && gBack.probe }));
    if (!ok) await shot(page, "fail-runs-reopen.png");
  }

  // ---- 7d. L12b item 7: Save as this process, and the toast's Undo --------------
  const PROCESSES = path.join(profileDir, "pdt-library", "processes.json");
  {
    const save = async () => {
      await page.locator(groupSel(R1) + ' [data-act="save-process"]').click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill(PROCESS_NAME, { timeout: T });
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      await waitToast(/Saved the process/);
    };
    let err = null, first = null, undone = null, second = null, toast1 = null;
    try {
      await save();
      toast1 = (await toastText()).text;
      first = await waitDisk(PROCESSES, (d) => d && d.processes && d.processes.length === 1);
      await page.locator('#toast [data-act="undo-save-process"]').click({ timeout: T });
      await waitToast(/no longer saved/);
      undone = await waitDisk(PROCESSES, (d) => d && d.processes && d.processes.length === 0);
      await save();
      second = await waitDisk(PROCESSES, (d) => d && d.processes && d.processes.length === 1);
    } catch (e) { err = errText(e); }
    const p = second && second.processes && second.processes[0];
    const want = [
      { draft_key: KEY_SEARCH, name: NAME_SEARCH }, { draft_key: KEY_OPEN, name: "Salesforce - Account lookup: Open customer record" },
      { draft_key: KEY_SAVE_ORDER, name: "Salesforce - Order: Save order" }, { draft_keys: [KEY_CHECK, KEY_CREATE], name: MERGED },
      { draft_key: KEY_EXCEL, name: "Excel - Order Tracking.xlsx: Save workbook" }, { draft_key: KEY_OUTLOOK, name: "Outlook - Order confirmation: Send" },
    ];
    const got = p ? p.steps.map((s) => (s.draft_keys ? { draft_keys: s.draft_keys, name: s.name } : { draft_key: s.draft_key, name: s.name })) : null;
    const manifest = readJson(path.join(SESSION, "manifest.json"));
    const ok = !err && first && first.version === 1 && toast1 === 'Saved the process "' + PROCESS_NAME + '".Undo' &&
      undone && undone.processes.length === 0 &&
      p && p.name === PROCESS_NAME && /^proc-/.test(p.id) && p.source_session_id === manifest.session_id &&
      !isNaN(Date.parse(p.saved_at)) && JSON.stringify(got) === JSON.stringify(want) &&
      p.steps.every((s) => typeof s.description === "string" && s.waste === false);
    record("L12b item 7: Save as this process writes the confirmed pattern run's 6 steps (draft_key, or draft_keys for the merge) to the profile's processes.json; the toast's Undo takes the save back",
      ok, JSON.stringify({ err, toast: toast1, undoneCount: undone && undone.processes.length, saved: p && { name: p.name, id: p.id, steps: got } }));
    if (!ok) await shot(page, "fail-runs-save-process.png");
  }

  // ---- 8. a rename in run 2 after confirming: the confirmed step keeps its name --
  let excelIds = {};
  {
    let err = null;
    try {
      await openRun(R2);
      const row = rowById(await rowByName(R2, "Excel - Order Tracking.xlsx: Save workbook").getAttribute("data-step-id", { timeout: T }));
      await row.locator(".step-name").dblclick({ timeout: T });
      await row.locator(".step-name-edit").fill(NAME_EXCEL, { timeout: T });
      await row.locator(".step-name-edit").press("Enter");
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => [R3, R4].every((r) => stepsOf(a, r).some((s) => s.draft_key === KEY_EXCEL && s.name === NAME_EXCEL)));
    const per = RUNS.map((r) => stepsOf(disk, r).find((s) => s.draft_key === KEY_EXCEL) || {});
    excelIds = Object.fromEntries(RUNS.map((r, i) => [r, per[i].step_id]));
    const store = fs.existsSync(STORE) ? readJson(STORE) : { names: {} };
    const ok = !err && per[0].state === "confirmed" && per[0].name === "Excel - Order Tracking.xlsx: Save workbook" &&
      per[1].state === "edited" && per[1].name === NAME_EXCEL &&
      [per[2], per[3]].every((s) => s.state === "auto_suggested" && s.name === NAME_EXCEL && s.name_source === "remembered") &&
      Object.keys(store.names).sort().join("|") === [KEY_EXCEL, KEY_SEARCH].sort().join("|");
    record("C4: a rename in run 2 names runs 3 and 4 at once, while the confirmed pattern step keeps its name; the store holds the two keys (not the one whose write failed)",
      ok, JSON.stringify({ err, per: per.map((s) => [s.state, s.name]), keys: Object.keys(store.names) }));
  }

  // ---- 8b. L12b item 5: a drafted step is hidden, never deleted --------------
  // Run 4 (not the pattern, so no Hide in all runs offer): the step editor has
  // no Delete for a draft, its one take-out button reads Hide step; ticking two
  // drafts turns the toolbar's bulk button into Hide selected, which hides them.
  let hiddenIds = [];
  {
    let err = null, noDelete = null, bulkLabel = null, disk = null;
    try {
      await openRun(R4);
      const outlookRow = rowByName(R4, "Outlook - Order confirmation: Send");
      const oid = await outlookRow.getAttribute("data-step-id", { timeout: T });
      await outlookRow.click({ timeout: T });
      await page.locator(".step-detail-more > summary").click({ timeout: T });
      noDelete = (await page.$("#btn-step-delete")) === null;
      await page.locator("#btn-step-hide", { hasText: /^Hide step$/ }).click({ timeout: T });
      await waitRows(R4, 5);
      const openId = await rowByName(R4, "Salesforce - Account lookup: Open customer record").getAttribute("data-step-id", { timeout: T });
      const saveId = await rowByName(R4, "Salesforce - Order: Save order").getAttribute("data-step-id", { timeout: T });
      await rowById(openId).locator(".multi-check").click({ timeout: T });
      await rowById(saveId).locator(".multi-check").click({ timeout: T });
      bulkLabel = ((await page.locator("#btn-delete-selected-steps").textContent({ timeout: T })) || "").trim();
      await page.locator("#btn-delete-selected-steps").click({ timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await waitRows(R4, 3);
      hiddenIds = [oid, openId, saveId];
      disk = await waitDisk(ANNO, (a) => hiddenIds.every((id) => (a.steps.find((s) => s.step_id === id) || {}).state === "hidden"));
    } catch (e) { err = errText(e); }
    const r4 = stepsOf(disk || { steps: [] }, R4);
    const ok = !err && noDelete && bulkLabel === "Hide selected" && r4.length === 6 &&
      hiddenIds.every((id) => { const s = r4.find((x) => x.step_id === id); return !!s && s.state === "hidden" && s._prev_state === "auto_suggested"; });
    record("L12b item 5: a drafted step has no Delete; Hide step and the bulk Hide selected hide drafts instead of deleting them (run 4 keeps its 6 steps, 3 hidden)",
      ok, JSON.stringify({ err, noDelete, bulkLabel, r4: r4.map((s) => s.state) }));
    if (!ok) await shot(page, "fail-runs-hide-not-delete.png");
  }

  // ---- 9. Re-analyze (Help, Troubleshooting): the confirm dialog answered, the run awaited
  {
    const before = readJson(STATS).meta.normalization_run_at;
    let err = null, dialogGone = false;
    try {
      await page.locator("#btn-help").click({ timeout: T });
      await page.locator('.help-nav-item[data-section="trouble"]').click({ timeout: T });
      await page.locator("#btn-help-reanalyze").click({ timeout: T });
      await page.waitForSelector(".modal-confirm", { state: "visible", timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await page.waitForSelector(".modal-confirm", { state: "detached", timeout: T });
      dialogGone = true;
      await page.waitForFunction(() => /Steps and map updated/.test((document.getElementById("toast") || {}).textContent || ""),
        null, { timeout: 180000 });
    } catch (e) { err = errText(e); }
    const after = await waitDisk(STATS, (s) => s.meta && s.meta.normalization_run_at !== before, 5000);
    const ran = !!(after && after.meta && after.meta.normalization_run_at !== before);
    record("Re-analyze (Help, Troubleshooting): its confirm dialog is answered and closes, and the recording is really analyzed again (stats.json rewritten)",
      !err && dialogGone && ran, JSON.stringify({ err, dialogGone, before, after: after && after.meta && after.meta.normalization_run_at }));
    if (!ran) await shot(page, "fail-runs-analyze.png");

    const disk = readJson(ANNO);
    const r1 = stepsOf(disk, R1).filter((s) => s.state !== "hidden");
    const names1 = r1.map((s) => s.state + ":" + s.name);
    const want1 = [
      "edited:" + NAME_SEARCH,
      "confirmed:Salesforce - Account lookup: Open customer record",
      "confirmed:Salesforce - Order: Save order",
      "edited:va01: Check document + va01: Create sales order",
      "confirmed:Excel - Order Tracking.xlsx: Save workbook",
      "confirmed:Outlook - Order confirmation: Send",
    ];
    await page.waitForSelector(groupSel(R1) + " .run-probe-text", { timeout: T }).catch(() => {});
    const g1 = await group(R1);
    const ok1 = JSON.stringify(names1) === JSON.stringify(want1) && g1 && g1.status === "Confirmed" && g1.probe === PROBE &&
      disk.pattern_run && disk.pattern_run.confirmed_at;
    record("after Re-analyze: run 1's confirmed and edited steps survived with their names; it still reads Confirmed with the same probe line",
      ok1, JSON.stringify({ names1, status: g1 && g1.status, probe: g1 && g1.probe }));

    const re = (r, key) => stepsOf(disk, r).find((s) => s.draft_key === key) || {};
    const redrafted = [re(R2, KEY_SEARCH), re(R3, KEY_SEARCH), re(R4, KEY_SEARCH), re(R3, KEY_EXCEL), re(R4, KEY_EXCEL)];
    const summary = ((readJson(STATS).meta || {}).draft_summary || {}).name_source || {};
    const ok2 = redrafted.every((s) => s.state === "auto_suggested" && s.name_source === "remembered") &&
      redrafted.slice(0, 3).every((s) => s.name === NAME_SEARCH) && redrafted.slice(3).every((s) => s.name === NAME_EXCEL) &&
      summary.remembered >= 5;
    record("after Re-analyze: re-drafted steps in runs 2 to 4 carry the remembered names with name_source remembered (the viewer passed --names)",
      ok2, JSON.stringify({ redrafted: redrafted.map((s) => [s.state, s.name, s.name_source]), draft_summary_name_source: summary }));

    const np = re(R2, KEY_NOTEPAD);
    record("after Re-analyze: the rename saved while the store was broken survived (edited, its name)",
      np.state === "edited" && np.name === NAME_NOTEPAD, JSON.stringify([np.state, np.name]));
    if (!(ok1 && ok2)) await shot(page, "fail-runs-after-analyze.png");

    // L12b item 5: the hidden drafts survived, and Analyze drafted none of them
    // again next to them (a deleted draft would be back).
    const r4 = stepsOf(disk, R4);
    const sameKey = (k) => r4.filter((s) => s.draft_key === k).map((s) => s.state);
    const okHidden = hiddenIds.length === 3 && hiddenIds.every((id) => (r4.find((s) => s.step_id === id) || {}).state === "hidden") &&
      [KEY_OUTLOOK, KEY_OPEN, KEY_SAVE_ORDER].every((k) => JSON.stringify(sameKey(k)) === '["hidden"]');
    record("after Re-analyze (L12b item 5): the 3 hidden drafts of run 4 are still hidden and none of them was drafted again",
      okHidden, JSON.stringify({ outlook: sameKey(KEY_OUTLOOK), open: sameKey(KEY_OPEN), saveOrder: sameKey(KEY_SAVE_ORDER) }));

    // The carried merges (edited) survived too, and their drafts were not drafted again.
    const carriedAfter = RUNS.map((r) => stepsOf(disk, r).filter(isCarried).length).join();
    const redraftedPair = disk.steps.filter((s) => s.draft_key === KEY_CHECK || s.draft_key === KEY_CREATE).length;
    record("after Re-analyze (L12b item 2): the carried merges of runs 2 to 4 survived and their drafts were not drafted again",
      carriedAfter === "1,2,1,1" && redraftedPair === 0, JSON.stringify({ carriedAfter, redraftedPair }));
  }

  // ---- 9b. L12b item 8: the Saved names dialog (Steps toolbar) --------------
  {
    const OTHER_KEY = "excel|Excel - Other book.xlsx|Button:save-workbook";
    const RENAMED = "Update the tracker";
    let err = null, rowsBefore = null, rowsAfter = null, afterRename = null, storeRename = null, storeForget = null, afterForget = null;
    const dialogRows = () => page.evaluate(() => [...document.querySelectorAll("#remembered-names-dialog .rn-row")].map((r) => ({
      key: r.dataset.key, name: r.querySelector(".rn-name").textContent.trim(), where: r.querySelector(".rn-where").textContent.trim() })));
    const rowSel = (key) => '#remembered-names-dialog .rn-row[data-key="' + key + '"]';
    try {
      // A name remembered in another session (its key is not in this one).
      const store = readJson(STORE);
      store.names[OTHER_KEY] = { name: "Save the other book", updated_at: "2026-09-01T10:00:00.000Z" };
      fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      await page.locator("#session-layout-steps .editor-toolbar #btn-remembered-names").click({ timeout: T });
      await page.waitForSelector("#remembered-names-dialog .rn-row", { timeout: T });
      rowsBefore = await dialogRows();
      // Rename: the store and this session's drafts with that key.
      await page.locator(rowSel(KEY_EXCEL) + ' [data-act="rename-name"]').click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill(RENAMED, { timeout: T });
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      await waitToast(/^Renamed/);
      afterRename = await waitDisk(ANNO, (a) => [R3, R4].every((r) => stepsOf(a, r).some((s) => s.draft_key === KEY_EXCEL && s.name === RENAMED)));
      storeRename = readJson(STORE);
      // Forget: the store entry goes, the session's names stay.
      await page.locator(rowSel(KEY_SEARCH) + ' [data-act="forget-name"]').click({ timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await waitToast(/^Forgot/);
      storeForget = await waitDisk(STORE, (s) => s && s.names && !s.names[KEY_SEARCH]);
      await page.waitForFunction(() => document.querySelectorAll("#remembered-names-dialog .rn-row").length === 2, null, { timeout: T });
      rowsAfter = await dialogRows();
      afterForget = readJson(ANNO);
      await page.locator('#remembered-names-dialog .modal-footer [data-act="close"]').click({ timeout: T });
    } catch (e) { err = errText(e); }
    const excelOf = (a, r) => stepsOf(a || { steps: [] }, r).find((s) => s.draft_key === KEY_EXCEL) || {};
    const okOrder = !err && JSON.stringify((rowsBefore || []).map((r) => [r.name, r.where])) === JSON.stringify([
      [NAME_SEARCH, "4 steps in this session"], [NAME_EXCEL, "4 steps in this session"], ["Save the other book", "Not in this session"]]);
    record("L12b item 8: the Saved names dialog lists the names whose key is in this session first, then the others",
      okOrder, JSON.stringify({ err, rows: rowsBefore }));
    const okRename = !err && storeRename && storeRename.names[KEY_EXCEL].name === RENAMED &&
      [R3, R4].every((r) => excelOf(afterRename, r).state === "auto_suggested" && excelOf(afterRename, r).name === RENAMED &&
        excelOf(afterRename, r).name_source === "remembered") &&
      excelOf(afterRename, R2).state === "edited" && excelOf(afterRename, R2).name === NAME_EXCEL &&
      excelOf(afterRename, R1).state === "confirmed" && excelOf(afterRename, R1).name === "Excel - Order Tracking.xlsx: Save workbook";
    record("L12b item 8: Rename changes the remembered name and names this session's drafts with that key (runs 3 and 4), not the edited or confirmed steps",
      okRename, JSON.stringify({ err, store: storeRename && storeRename.names[KEY_EXCEL], steps: RUNS.map((r) => [excelOf(afterRename, r).state, excelOf(afterRename, r).name]) }));
    const okForget = !err && storeForget && !storeForget.names[KEY_SEARCH] && storeForget.names[OTHER_KEY] &&
      JSON.stringify((rowsAfter || []).map((r) => r.name)) === JSON.stringify([RENAMED, "Save the other book"]) &&
      [R2, R3, R4].every((r) => (stepsOf(afterForget || { steps: [] }, r).find((s) => s.draft_key === KEY_SEARCH) || {}).name === NAME_SEARCH);
    record("L12b item 8: Forget removes the name from the store (the list follows) while the session's steps keep it",
      okForget, JSON.stringify({ err, keys: storeForget && Object.keys(storeForget.names), rows: rowsAfter && rowsAfter.map((r) => r.name) }));
    if (!(okOrder && okRename && okForget)) await shot(page, "fail-runs-names-dialog.png");
  }

  // ---- 10. item 8: marker at the clicked moment; local times in the Markers list --
  {
    let err = null, info = null, edit = null;
    const LABEL = "E2E clicked moment";
    try {
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector("#timeline .tl-activity", { state: "visible", timeout: T });
      // The longest activity band (the i-th band is the i-th activity event),
      // at a point well inside it where the band itself is on top (an idle
      // band drawn over it would route the click to the background menu).
      info = await page.evaluate(() => {
        const evs = require("./state.js").getSession().events.filter((e) => e.type === "activity");
        const bands = [...document.querySelectorAll("#timeline .tl-activity")];
        let best = -1;
        evs.forEach((e, i) => { if (best < 0 || (e.data.duration_ms || 0) > (evs[best].data.duration_ms || 0)) best = i; });
        const b = bands[best];
        b.scrollIntoView({ block: "center", inline: "center" });
        const r = b.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const frac = [0.75, 0.7, 0.8, 0.65, 0.85].find((f) => {
          const hit = document.elementFromPoint(r.left + f * r.width, y);
          return hit && hit.closest(".tl-activity") === b;
        });
        return { i: best, bands: bands.length, events: evs.length, t0: evs[best].timestamp, dur: evs[best].data.duration_ms,
          frac: frac || null, x: r.left + (frac || 0.75) * r.width, y, w: r.width };
      });
      if (!info.frac) throw new Error("no point inside the band where the band is on top");
      await page.mouse.click(info.x, info.y, { button: "right" });
      await page.locator("#tl-ctx-menu div", { hasText: "Insert Start marker here" }).click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill(LABEL, { timeout: T });
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      const a = await waitDisk(ANNO, (x) => (x.marker_edits || []).some((e) => e && e.op === "insert" && e.label === LABEL));
      edit = (a.marker_edits || []).find((e) => e && e.op === "insert" && e.label === LABEL) || null;
    } catch (e) { err = errText(e); }
    const expected = info && info.frac ? Date.parse(info.t0) + info.frac * info.dur : NaN;
    const at = edit ? Date.parse(edit.timestamp) : NaN;
    const ok = !err && info && info.bands === info.events && info.dur >= 8000 &&
      Math.abs(at - expected) <= 1500 && at - Date.parse(info.t0) >= 3000;
    record("item 8: Insert Start marker from an activity band's menu lands at the clicked moment (well inside the band), not at the band start",
      ok, JSON.stringify({ err, band: info && { t0: info.t0, dur: info.dur, frac: info.frac, w: Math.round(info.w || 0) }, inserted: edit && edit.timestamp,
        expected: isFinite(expected) ? new Date(expected).toISOString() : null }));
    if (!ok) await shot(page, "fail-runs-marker-at-click.png");

    // The Markers list: local clock times, as the timeline axis shows them.
    let rows = null;
    try {
      await page.waitForSelector("#markers-list .marker-row", { timeout: T });
      rows = await page.evaluate(() => {
        const view = require("./marker-edits.js").sessionMarkerView(require("./state.js").getSession());
        const byKey = Object.fromEntries(view.map((m) => [m.key, m.timestamp]));
        return [...document.querySelectorAll("#markers-list .marker-row")].map((r) => ({
          ts: byKey[r.dataset.markerKey], shown: ((r.querySelector(".ts") || {}).textContent || "").trim(),
        }));
      });
    } catch (e) { rows = [{ err: errText(e) }]; }
    const pad = (n) => String(n).padStart(2, "0");
    const local = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
    const offsetMin = new Date(Date.parse("2026-05-14T09:00:00Z")).getTimezoneOffset();
    const bad = (rows || []).filter((r) => r.err || r.shown !== local(r.ts));
    const differsFromUtc = (rows || []).filter((r) => r.ts && r.shown !== String(r.ts).slice(11, 19)).length;
    const ok2 = rows && rows.length >= 9 && bad.length === 0 && (offsetMin === 0 || differsFromUtc === rows.length);
    record("item 8: the Markers list shows local clock times (the timeline's clock), not UTC",
      ok2, "rows=" + (rows || []).length + " mismatched=" + JSON.stringify(bad.slice(0, 3)) +
        " utcOffsetMinutes=" + (-offsetMin) + (offsetMin === 0 ? " (UTC machine: local equals UTC, so this check cannot tell them apart here)" : ""));
  }

  // ---- 11. L12b items 3 and 7: a second session of the same process ---------
  // A second temp copy of the demo, analyzed afresh (all drafts, no pattern run
  // confirmed) and SEEDED in run 4 with a step added by hand where the
  // "Save order" draft was (removed): an extra step and a skipped step the demo
  // does not have. Opened in the same viewer (the same profile, so the process
  // saved in 7d is there), it is compared with the saved process.
  {
    let err = null, S2 = null, before = null, line = null, st = null, seen = {}, after = {}, stopped = null;
    try {
      S2 = freshSession();
      if (!S2) throw new Error("the second copy could not be analyzed");
      _temps.push(S2);
      const A2 = path.join(S2, "annotations.json");
      const runs2 = runIds(path.join(S2, "stats.json"));
      if (runs2.join() !== RUNS.join()) throw new Error("the second copy's runs differ: " + runs2.join());
      const anno2 = readJson(A2);
      const gone = anno2.steps.find((s) => s.case_id === R4 && s.draft_key === KEY_SAVE_ORDER);
      anno2.steps = anno2.steps.filter((s) => s !== gone);
      anno2.steps.push({ step_id: "e2e-added-call", session_id: gone.session_id, case_id: R4, name: "Call the customer",
        description: "", time_range: gone.time_range, evidence: { interaction_event_ids: [], screenshot_refs: [], video_timecode_range: null, manual_notes: "" },
        state: "manually_authored", canonical_step_id: null, flags: { waste: false }, phase_id: null });
      fs.writeFileSync(A2, JSON.stringify(anno2, null, 2));
      before = fs.readFileSync(A2, "utf-8");
      await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), S2);
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      await page.waitForSelector("#step-list .runs-compare", { timeout: T });
      line = await page.$eval("#step-list .runs-compare-text", (el) => el.textContent.trim());
      st = await runsState();
      for (const r of RUNS) { await openRun(r); seen[r] = (await group(r)).diffs; }
      await shot(page, "runs-smoke-saved-process.png");
      await page.locator('#step-list .runs-compare [data-act="stop-comparing"]').click({ timeout: T });
      await page.waitForFunction(() => !document.querySelector("#step-list .runs-compare"), null, { timeout: T });
      for (const r of [R2, R3, R4]) { await openRun(r); after[r] = (await group(r)).diffs; }
      stopped = await runsState();
    } catch (e) { err = errText(e); }
    const metas = (s) => RUNS.map((r) => metaDiffs(((s || []).find((g) => g.caseId === r) || {}).meta));
    const WANT = {
      [R1]: [],
      [R2]: ["Extra step: Notepad - Internal mappings.txt (after " + MERGED + ")."],
      [R3]: ["Skipped: Outlook - Order confirmation: Send (step 6 of the saved process)."],
      [R4]: ["Extra step: Call the customer (after Salesforce - Account lookup: Open customer record).",
        "Skipped: Salesforce - Order: Save order (step 3 of the saved process)."],
    };
    const ok = !err && line === "Compared with saved process " + PROCESS_NAME &&
      RUNS.every((r) => JSON.stringify(seen[r]) === JSON.stringify(WANT[r])) &&
      metas(st).join() === "no differences,1 difference,1 difference,2 differences" &&
      fs.readFileSync(path.join(S2, "annotations.json"), "utf-8") === before;
    record("L12b items 3 + 7: a second copy of the demo (seeded with an extra and a skipped step) opens compared with the saved process: the line, and every run's differences from it (the file is not changed)",
      ok, JSON.stringify({ err, line, seen: RUNS.map((r) => seen[r]), metas: metas(st) }));
    const WANT_STOP = {
      [R2]: ["Extra step: Notepad - Internal mappings.txt (after va01: Create sales order)."],
      [R3]: ["Skipped: Outlook - Order confirmation: Send (step 7 of the pattern run)."],
      [R4]: ["Extra step: Call the customer (after Salesforce - Account lookup: Open customer record).",
        "Skipped: Salesforce - Order: Save order (step 3 of the pattern run)."],
    };
    const okStop = !err && [R2, R3, R4].every((r) => JSON.stringify(after[r]) === JSON.stringify(WANT_STOP[r])) &&
      metas(stopped)[0] === null;
    record("L12b item 7: Stop comparing removes the line and compares the runs with the session's own pattern run",
      okStop, JSON.stringify({ err, after: [R2, R3, R4].map((r) => after[r]), metas: metas(stopped) }));
    if (!(ok && okStop)) await shot(page, "fail-runs-saved-process.png");

    // C5's gate: the first session, whose pattern run is confirmed, is NOT
    // compared when it opens again, although the saved process matches its
    // steps (the control: the same match the viewer runs, on its steps).
    let err2 = null, control = null, lineBack = null, confirmedBack = null;
    try {
      await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), SESSION);
      await page.waitForFunction((n) => {
        const g = document.querySelector("#step-list .run-group.pattern .run-probe-text");
        return !!(g && g.textContent.trim()) && document.querySelectorAll("#step-list .run-group").length === n;
      }, RUNS.length, { timeout: T });
      control = await page.evaluate(async (name) => {
        const saved = await require("./ipc.js").readProcesses();
        const s = require("./state.js").getSession();
        const m = require("./run-differences.js").matchSavedProcess(saved.processes, s.annotations.steps);
        return m && { name: m.process.name, score: Math.round(m.score * 100) / 100, want: name };
      }, PROCESS_NAME);
      await wait(1500);   // the match on open is asynchronous: give it time to (wrongly) arrive
      lineBack = await page.$("#step-list .runs-compare");
      confirmedBack = (await group(R1) || {}).status;
    } catch (e) { err2 = errText(e); }
    record("L12b item 7 (C5 gate): a session whose pattern run is confirmed opens without the comparison, although the saved process matches it",
      !err2 && control && control.name === PROCESS_NAME && control.score >= 0.5 && lineBack === null && confirmedBack === "Confirmed",
      JSON.stringify({ err: err2, control, lineShown: lineBack !== null, status: confirmedBack }));

    // P3.11: "Forget this saved process", the inverse of Save as this process
    // where the saved process shows: the second copy opens compared with it
    // again; Forget takes it out of the profile's processes.json and the line
    // goes; the toast's Undo brings both back.
    let err3 = null, forgot = null, lineGone = null, restored = null, lineBackAgain = null;
    try {
      await page.evaluate((f) => require("./views/flow-view.js").loadSessionIntoView(f), S2);
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      await page.waitForSelector('#step-list .runs-compare [data-act="forget-process"]', { timeout: T });
      await page.locator('#step-list .runs-compare [data-act="forget-process"]').click({ timeout: T });
      await waitToast(/^Forgot the saved process/);
      forgot = await waitDisk(PROCESSES, (d) => d && d.processes && d.processes.length === 0);
      lineGone = await page.waitForFunction(() => !document.querySelector("#step-list .runs-compare"), null, { timeout: T })
        .then(() => true, () => false);
      await page.locator('#toast [data-act="undo-forget-process"]').click({ timeout: T });
      await waitToast(/saved process is back/);
      restored = await waitDisk(PROCESSES, (d) => d && d.processes && d.processes.length === 1);
      lineBackAgain = await page.waitForSelector("#step-list .runs-compare", { timeout: T }).then(() => true, () => false);
    } catch (e) { err3 = errText(e); }
    const back1 = restored && restored.processes && restored.processes[0];
    record("P3.11: Forget this saved process takes it out of processes.json and the comparison line goes; the toast's Undo brings both back",
      !!(!err3 && forgot && forgot.processes.length === 0 && lineGone && back1 && back1.name === PROCESS_NAME &&
        back1.steps.length === 6 && lineBackAgain),
      JSON.stringify({ err: err3, forgot: forgot && forgot.processes.length, lineGone,
        restored: back1 && { name: back1.name, steps: back1.steps.length }, lineBackAgain }));
  }

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-runs-page-errors.png");

  await viewer.close();
  for (const dir of _temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
  }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n[runs-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[runs-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[runs-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
