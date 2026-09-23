"use strict";
/*
 * Runs-and-steps e2e smoke (BA helper cycle, lane L7a; contracts C1 to C4).
 *
 * Launches the REAL viewer on a throwaway profile (launchViewer) against a
 * TEMP copy of the committed demo session sess-2026-0514-0900, re-analyzed
 * with the current pipeline (4 marked runs, 30 drafted steps), and pins the
 * verbs of the Steps level the way an analyst uses them:
 *   - the runs list: 4 runs in time order, run 1 the pattern, open with its
 *     drafted steps; "Use as pattern" and its Ctrl+Z;
 *   - names (C4): a rename of a run-1 draft names the same-key drafts of the
 *     other runs at once (still drafts, name_source "remembered") and lands in
 *     the profile's remembered-names store; a broken store shows an error and
 *     still saves the session rename; the name box suggests the name;
 *   - the draft-fix counter (C3): merge / split / add / drop each count on the
 *     pattern run, renames do not, and Ctrl+Z, Unhide and deleting an added
 *     step take a count back;
 *   - the keyboard: Up / Down / Enter on the open run, and no shortcut acting
 *     on a step the list does not show (RP-12);
 *   - Confirm run: the states, the Confirmed status and the probe line, which
 *     Copy puts on the clipboard;
 *   - Analyze (its confirm dialog answered and the run awaited, never assumed):
 *     the confirmed and edited steps survive with their names, and re-drafted
 *     steps carry the remembered names (the viewer passed --names);
 *   - item 8: a Start marker inserted from an activity band's menu lands at the
 *     clicked moment, and the Markers list shows local times.
 *
 * Writes only into its temp copy and its throwaway profile. Exits 0 when every
 * check passed, 1 on a failed check, 2 when it could not run (no Python with
 * the pipeline dependencies, or no Electron).
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
function runIds() {
  return (readJson(STATS).case_stats || []).filter((c) => !c.parent_case_id)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts) || (a.case_id < b.case_id ? -1 : 1))
    .map((c) => c.case_id);
}
const stepsOf = (anno, caseId) => (anno.steps || []).filter((s) => s.case_id === caseId)
  .sort((a, b) => a.time_range.start.localeCompare(b.time_range.start));

const KEY_SEARCH = "chrome|Salesforce - Account lookup|Button:search";
const KEY_EXCEL = "excel|Excel - Order Tracking.xlsx|Button:save-workbook";
const KEY_NOTEPAD = "notepad|Notepad - Internal mappings.txt|(visit)";
const NAME_SEARCH = "Look up the customer";
const NAME_EXCEL = "Update the order tracker";
const NAME_NOTEPAD = "Look up the plant code";

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
  const fixesOf = async (caseId) => ((await group(caseId)) || {}).fixes || "";
  const waitFixes = (caseId, text) => page.waitForFunction(([sel, t]) => {
    const f = document.querySelector(sel + " .run-fixes");
    return !!(f && f.textContent.trim() === t);
  }, [groupSel(caseId), text], { timeout: T });
  const waitRows = (caseId, n) => page.waitForFunction(([sel, k]) =>
    document.querySelectorAll(sel + " .step-row").length === k, [groupSel(caseId), n], { timeout: T });
  const toastText = () => page.$eval("#toast", (el) => ({ text: el.textContent || "", error: el.className.includes("error") }));
  const FIX0 = "Boundary fixes so far: 0 (merge 0, split 0, add 0, drop 0)";
  const [R1, R2, R3, R4] = RUNS;

  // ---- 1. the runs list ----------------------------------------------------
  {
    const st = await runsState();
    const r1 = st[0] || {};
    const ok = st.length === 4 && st.map((g) => g.caseId).join() === RUNS.join() &&
      st.map((g) => g.title).join() === "Run 1,Run 2,Run 3,Run 4" &&
      r1.pattern && st.filter((g) => g.pattern).length === 1 && r1.open && st.filter((g) => g.open).length === 1 &&
      r1.rows.length === 7 && r1.rows.every((r) => r.chip === "Draft") && st.every((g) => g.status === "Draft") &&
      r1.fixes === FIX0;
    record("Steps shows the 4 runs in time order; run 1 is the pattern, open with its 7 drafted steps", ok,
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
      await page.locator(groupSel(R3) + ' [data-act="use-pattern"]').click({ timeout: T });
      await page.waitForFunction((sel) => document.querySelector(sel).classList.contains("pattern"), groupSel(R3), { timeout: T });
      moved = (await runsState()).filter((g) => g.pattern).map((g) => g.caseId);
      diskMoved = (await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.case_id === R3)).pattern_run;
      await page.keyboard.press("Control+z");
      await page.waitForFunction((sel) => document.querySelector(sel).classList.contains("pattern"), groupSel(R1), { timeout: T });
      back = (await runsState()).filter((g) => g.pattern).map((g) => g.caseId);
      diskBack = (await waitDisk(ANNO, (a) => !a.pattern_run)).pattern_run;
    } catch (e) { err = errText(e); }
    const ok = !err && JSON.stringify(moved) === JSON.stringify([R3]) && diskMoved && diskMoved.case_id === R3 &&
      diskMoved.confirmed_at === null && diskMoved.drafted_steps === 6 &&
      JSON.stringify(diskMoved.draft_fixes) === JSON.stringify({ merge: 0, split: 0, add: 0, drop: 0 }) &&
      JSON.stringify(back) === JSON.stringify([R1]) && diskBack === undefined;
    record("C3: Use as pattern makes run 3 the pattern (pattern_run written); Ctrl+Z makes run 1 the pattern again",
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
    const ok2 = row2.name === NAME_SEARCH && row2.chip === "Draft" && row2.remembered;
    record("C4: run 2 shows the new name on its draft right away (Draft chip, remembered tag), without a re-analysis",
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
    record("C3: renames are not counted (the pattern run still reads 0 fixes)", (await fixesOf(R1)) === FIX0, await fixesOf(R1));

    // Merge with next (right-click menu).
    let err = null, disk = null;
    try {
      await rowByName(R1, "va01: Check document").click({ button: "right", timeout: T });
      await page.locator("#step-ctx-menu div", { hasText: /^Merge with next$/ }).click({ timeout: T });
      await waitRows(R1, 6);
      await waitFixes(R1, "Boundary fixes so far: 1 (merge 1, split 0, add 0, drop 0)");
      disk = await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.draft_fixes && a.pattern_run.draft_fixes.merge === 1);
    } catch (e) { err = errText(e); }
    const g = await group(R1);
    const merged = g.rows.find((r) => r.name === "va01: Check document + va01: Create sales order");
    const pr = disk && disk.pattern_run;
    const ok = !err && merged && merged.chip === "Edited" && pr && pr.case_id === R1 && pr.confirmed_at === null &&
      pr.drafted_steps === 7 && JSON.stringify(pr.draft_fixes) === JSON.stringify({ merge: 1, split: 0, add: 0, drop: 0 });
    record("C3: Merge with next on the pattern run counts one merge (pattern_run written: run 1, drafted_steps 7)",
      ok, JSON.stringify({ err, merged, pattern_run: pr, fixes: g.fixes }));
    if (!ok) await shot(page, "fail-runs-merge.png");

    // Undo takes the count back; redo brings it back.
    let err2 = null;
    try {
      await page.keyboard.press("Control+z");
      await waitRows(R1, 7);
      await waitFixes(R1, FIX0);
      await page.keyboard.press("Control+y");
      await waitRows(R1, 6);
      await waitFixes(R1, "Boundary fixes so far: 1 (merge 1, split 0, add 0, drop 0)");
    } catch (e) { err2 = errText(e); }
    record("C3: Ctrl+Z of the merge takes the count back to 0; Ctrl+Y brings the merge and its count back",
      !err2, err2 || "undo 7 rows / 0 fixes, redo 6 rows / merge 1");

    // S splits the selected (visible) step: a split; Ctrl+Z takes it back.
    let err3 = null;
    try {
      await rowByName(R1, "Excel - Order Tracking.xlsx: Save workbook").click({ timeout: T });
      await page.keyboard.press("s");
      await waitRows(R1, 7);
      await waitFixes(R1, "Boundary fixes so far: 2 (merge 1, split 1, add 0, drop 0)");
      await page.keyboard.press("Control+z");
      await waitRows(R1, 6);
      await waitFixes(R1, "Boundary fixes so far: 1 (merge 1, split 0, add 0, drop 0)");
    } catch (e) { err3 = errText(e); }
    record("C3: S splits the selected step and counts a split; Ctrl+Z takes the split and its count back",
      !err3, err3 || "7 rows / split 1, then 6 rows / split 0");

    // Hide a draft (a drop), list it with Show hidden steps, Unhide (drop back).
    let err4 = null, hiddenRow = null;
    try {
      const outlook = rowByName(R1, "Outlook - Order confirmation: Send");
      const oid = await outlook.getAttribute("data-step-id");
      await outlook.click({ timeout: T });
      await page.locator("#btn-step-hide").click({ timeout: T });
      await waitRows(R1, 5);
      await waitFixes(R1, "Boundary fixes so far: 2 (merge 1, split 0, add 0, drop 1)");
      const toggle = page.locator(groupSel(R1) + ' [data-act="show-hidden"]');
      await toggle.check({ timeout: T });
      await waitRows(R1, 6);
      hiddenRow = ((await group(R1)).rows.find((r) => r.id === oid)) || null;
      await rowById(oid).click({ timeout: T });
      await page.locator("#btn-step-hide", { hasText: "Unhide" }).click({ timeout: T });
      await waitFixes(R1, "Boundary fixes so far: 1 (merge 1, split 0, add 0, drop 0)");
      await waitRows(R1, 6);
    } catch (e) { err4 = errText(e); }
    // With nothing hidden any more the switch is gone (no switch that does nothing).
    const noToggle = (await group(R1)).showHidden === null;
    const ok4 = !err4 && hiddenRow && hiddenRow.chip === "Hidden" && hiddenRow.state === "hidden" && noToggle;
    record("C3: hiding a draft counts a drop; Show hidden steps lists it with a Hidden chip; Unhide takes the drop back",
      ok4, err4 || JSON.stringify(hiddenRow));

    // + Add step lands in the open run after the selected step: an add; deleting it takes the add back.
    let err5 = null, added = null, addedDisk = null;
    try {
      await rowById(searchIds[R1]).click({ timeout: T });
      await page.locator("#btn-add-manual-step").click({ timeout: T });
      await page.locator(".modal-prompt .modal-input").fill("Check the stock", { timeout: T });
      await page.locator(".modal-prompt .modal-ok").click({ timeout: T });
      await waitRows(R1, 7);
      await waitFixes(R1, "Boundary fixes so far: 2 (merge 1, split 0, add 1, drop 0)");
      const g1 = await group(R1);
      added = { index: g1.rows.findIndex((r) => r.name === "Check the stock"), row: g1.rows.find((r) => r.name === "Check the stock") };
      addedDisk = (await waitDisk(ANNO, (a) => (a.steps || []).some((s) => s.name === "Check the stock")))
        .steps.find((s) => s.name === "Check the stock");
      await page.locator(".step-detail-more > summary").click({ timeout: T });
      await page.locator("#btn-step-delete").click({ timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await waitRows(R1, 6);
      await waitFixes(R1, "Boundary fixes so far: 1 (merge 1, split 0, add 0, drop 0)");
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
  const PROBE = "Run 1: 7 drafted steps, 1 boundary fix (merge 1, split 0, add 0, drop 0)";
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

    let clip = null;
    try {
      await page.locator(groupSel(R1) + ' [data-act="copy-probe"]').click({ timeout: T });
      await wait(300);
      clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    } catch (e) { clip = "error: " + errText(e); }
    record("C3: Copy puts the probe line on the clipboard", clip === PROBE, JSON.stringify(clip));
    await shot(page, "runs-smoke-confirmed.png");
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

  // ---- 9. Analyze: the confirm dialog answered, the run awaited --------------
  {
    const before = readJson(STATS).meta.normalization_run_at;
    let err = null, dialogGone = false;
    try {
      await page.locator("#btn-normalize").click({ timeout: T });
      await page.waitForSelector(".modal-confirm", { state: "visible", timeout: T });
      await page.locator(".modal-confirm .modal-ok").click({ timeout: T });
      await page.waitForSelector(".modal-confirm", { state: "detached", timeout: T });
      dialogGone = true;
      await page.waitForFunction(() => /Analysis complete/.test((document.getElementById("toast") || {}).textContent || ""),
        null, { timeout: 180000 });
    } catch (e) { err = errText(e); }
    const after = await waitDisk(STATS, (s) => s.meta && s.meta.normalization_run_at !== before, 5000);
    const ran = !!(after && after.meta && after.meta.normalization_run_at !== before);
    record("Analyze: its confirm dialog is answered and closes, and the session is really re-analyzed (stats.json rewritten)",
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
    record("after Analyze: run 1's confirmed and edited steps survived with their names; it still reads Confirmed with the same probe line",
      ok1, JSON.stringify({ names1, status: g1 && g1.status, probe: g1 && g1.probe }));

    const re = (r, key) => stepsOf(disk, r).find((s) => s.draft_key === key) || {};
    const redrafted = [re(R2, KEY_SEARCH), re(R3, KEY_SEARCH), re(R4, KEY_SEARCH), re(R3, KEY_EXCEL), re(R4, KEY_EXCEL)];
    const summary = ((readJson(STATS).meta || {}).draft_summary || {}).name_source || {};
    const ok2 = redrafted.every((s) => s.state === "auto_suggested" && s.name_source === "remembered") &&
      redrafted.slice(0, 3).every((s) => s.name === NAME_SEARCH) && redrafted.slice(3).every((s) => s.name === NAME_EXCEL) &&
      summary.remembered >= 5;
    record("after Analyze: re-drafted steps in runs 2 to 4 carry the remembered names with name_source remembered (the viewer passed --names)",
      ok2, JSON.stringify({ redrafted: redrafted.map((s) => [s.state, s.name, s.name_source]), draft_summary_name_source: summary }));

    const np = re(R2, KEY_NOTEPAD);
    record("after Analyze: the rename saved while the store was broken survived (edited, its name)",
      np.state === "edited" && np.name === NAME_NOTEPAD, JSON.stringify([np.state, np.name]));
    if (!(ok1 && ok2)) await shot(page, "fail-runs-after-analyze.png");
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

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-runs-page-errors.png");

  await viewer.close();
  try { fs.rmSync(SESSION, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n[runs-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[runs-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[runs-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
