"use strict";
/*
 * Sub-process e2e smoke (contract C19, AD-33; lane SUB-V1): the Steps level
 * at a level, and the verbs that make and undo a sub-process.
 *
 * Launches the REAL viewer on a throwaway profile (launchViewer) against a
 * TEMP copy of the committed demo session sess-2026-0514-0900, re-analyzed
 * with the current pipeline (4 transactions of drafted steps), and pins:
 *   - Open as a sub-process (the step pane) on the reference transaction's
 *     "Save order": every transaction's occurrence gets one drafted sub-step
 *     per recorded action, named without the values typed (Enter Product
 *     code, ..., Click Save order), and the parent is edited, on disk; the
 *     list then shows the new level: the breadcrumb (Main process, Save
 *     order, Dissolve sub-process) and one block per visit, the reference
 *     transaction's marked and the others compared with it;
 *   - a drafted sub-step renamed: the other transactions' drafts of its
 *     action take the name (still drafts, name_source remembered), and no
 *     remembered-names store is written (contract C21 removed it);
 *   - the breadcrumb goes up (the step it was inside selected), and the
 *     sub-process row's "▸ 6 sub-steps" opens it again;
 *   - Group into a sub-process (two consecutive main-level steps of the
 *     reference transaction, and a name): the same steps are grouped in every
 *     transaction, on disk (transaction 2 twice);
 *   - Dissolve both: the group from its step pane (nothing is lost, so no
 *     confirm) and the opened step from the breadcrumb (one confirm names
 *     the description written on a sub-step); Ctrl+Z restores each;
 *   - Confirm transaction confirms the reference transaction's drafts at
 *     every level; a new sub-process with drafts makes it read Draft again;
 *   - the step panel and the Timeline's steps lane follow the level (the
 *     occurrences of a sub-step in every visit, the panel opened from its
 *     row from 1440 px and from the editor's Play below, plan D2; "Steps in
 *     Save order");
 *   - the Map at a level (lane SUB-V2): the picker lists every map (Main
 *     process, then each sub-process indented with its number) and the live
 *     map marks the sub-processes' boxes; choosing Save order draws its live
 *     map (its boxes are its sub-steps) and Steps shows the same level; a
 *     double-click on a marked box opens its map; Export, Process map (image)
 *     saves the plane of the map shown; an As-Is copy made after the
 *     sub-process shows its plane, a task there opens the panel at that
 *     level, and bpmn-js's own drill down keeps the picker in step; the PDD
 *     carries a picture per sub-process chapter.
 *
 * Writes only into its temp copy and its throwaway profile. Exits 0 when
 * every check passed, 1 on a failed check, 2 when it could not run (no
 * Python with the pipeline dependencies, or no Electron).
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
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}
const errText = (e) => { logActionError("subprocess-smoke", e); return String((e && e.message) || e).split("\n")[0]; };

/* Lane MV: the Map opens on the map the PDD prints and analyzes first when
   the steps are newer than it; mapSettled waits until that analysis (and any
   other queued or running) has ended. */
async function mapSettled(page) {
  await page.waitForFunction(() => !require("./refmap-ui.js").mapBusy() && !require("./views/flow-view.js").analysisBusy(),
    null, { timeout: 180000 });
}

/* The demo, copied to temp and analyzed with the current pipeline. */
function freshSession() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-subproc-"));
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
  console.log("[subprocess-e2e] FATAL: no Python with the pipeline dependencies to analyze the demo");
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

/* The entries of a .docx (a zip): { name: Buffer }. Stored or deflated. */
function zipFiles(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const out = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < buf.readUInt16LE(eocd + 10); k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), local = buf.readUInt32LE(p + 42);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/* Run case ids in time order (the order the view uses). */
function runIds() {
  return (readJson(STATS).case_stats || []).filter((c) => !c.parent_case_id)
    .sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts) || (a.case_id < b.case_id ? -1 : 1))
    .map((c) => c.case_id);
}

const K_SAVE = "chrome|Salesforce - Order|Button:save-order";
const K_CHECK = "sapgui|va01|MenuItem:check-document";
const K_EXCEL = "excel|Excel - Order Tracking.xlsx|Button:save-workbook";
const SAVE = "Salesforce" + " " + String.fromCharCode(45) + " " + "Order: Save order";
const ACTIONS = ["Enter Product code", "Enter Quantity", "Enter Unit price", "Enter Shipping address", "Enter Delivery method", "Click Save order"];
const RENAMED = "Type the quantity";
const GROUP = "Create the sales order in SAP";
const NOTE_LEVEL = "One block per time a transaction goes through this sub-process.";

/* Every step at every level of a list of steps. */
function tree(steps) {
  const out = [];
  const walk = (l) => { for (const s of l || []) { out.push(s); if (Array.isArray(s.sub_steps)) walk(s.sub_steps); } };
  walk(steps);
  return out;
}
const opened = (anno) => (anno.steps || []).filter((s) => s.draft_key === K_SAVE && Array.isArray(s.sub_steps));
const groups = (anno) => (anno.steps || []).filter((s) => s.group === true);

(async () => {
  const RUNS = runIds();
  const pre = readJson(ANNO);
  const perRun = RUNS.map((r) => (pre.steps || []).filter((s) => s.case_id === r && s.draft_key === K_SAVE).length);
  const preOk = RUNS.length === 4 && perRun.every((n) => n === 1) && !tree(pre.steps).some((s) => s.sub_steps);
  record("precondition: the demo analyzes to 4 transactions, each with one drafted Save order step, and no sub-process",
    preOk, "runs=" + RUNS.length + " save order per run=" + perRun.join(","));
  if (!preOk) process.exit(1);
  const [R1, R2] = RUNS;

  let viewer;
  try {
    viewer = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + SESSION], cwd: VIEWER });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }
  const { app, profileDir } = viewer;
  // C21: the remembered step names left the app: no store is ever written.
  const STORE = path.join(profileDir, "pdt-library", "remembered-names.json");
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
  await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
  await page.waitForSelector("#step-list .run-group", { timeout: T });

  /* ---- page probes ------------------------------------------------------- */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRow = (name) => page.locator("#step-list .run-group.open .step-row").filter({
    has: page.locator(".step-name", { hasText: new RegExp("^" + esc(name) + "$") }),
  }).first();
  const level = () => page.evaluate(() => {
    const nav = document.getElementById("steps-crumbs");
    return {
      crumbs: nav && !nav.hidden ? [...nav.querySelectorAll(".crumb")].map((c) => c.textContent.trim()) : [],
      dissolve: !!(nav && !nav.hidden && nav.querySelector("#btn-dissolve-level")),
      note: (document.getElementById("runs-pane-note") || {}).textContent || "",
      blocks: [...document.querySelectorAll("#step-list .run-group")].map((g) => ({
        caseId: g.dataset.caseId || null, visit: g.dataset.visit || null, open: g.classList.contains("open"),
        title: ((g.querySelector(".run-title") || {}).textContent || "").trim(),
        badge: ((g.querySelector(".run-pattern-badge") || {}).textContent || "").trim(),
        status: ((g.querySelector(".run-status") || {}).textContent || "").trim(),
        meta: ((g.querySelector(".run-meta") || {}).textContent || "").trim(),
        rows: [...g.querySelectorAll(".step-row .step-name")].map((n) => n.textContent.trim()),
      })),
      selected: ((document.querySelector("#step-list .step-row.selected .step-name") || {}).textContent || "").trim(),
    };
  });
  const blur = () => page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const openBlock = async (caseId) => {
    const sel = '#step-list .run-group[data-case-id="' + caseId + '"]';
    if (await page.locator(sel + ".open").count()) return;
    await page.locator(sel + " > .run-row").first().click({ timeout: T });
    await page.waitForSelector(sel + ".open", { timeout: T });
  };

  // ---- 1. Open as a sub-process ------------------------------------------
  {
    let err = null, lv = null;
    try {
      await openRow(SAVE).click({ timeout: T });
      await page.locator("#btn-step-make-sub").click({ timeout: T });
      await page.waitForSelector("#steps-crumbs:not([hidden])", { timeout: T });
      lv = await level();
      await shot(page, "subproc-steps-level.png");
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => opened(a).length === 4);
    const occ = opened(disk);
    const inter = {};
    for (const line of fs.readFileSync(path.join(SESSION, "events.jsonl"), "utf-8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "interaction") inter[ev.event_id] = ev;
    }
    const valueFree = occ.every((s) => s.sub_steps.every((x) => (x.evidence.interaction_event_ids || [])
      .every((id) => { const v = inter[id] && inter[id].data && inter[id].data.value; return !v || !x.name.includes(String(v)); })));
    const okDisk = occ.length === 4 && occ.every((s) => s.state === "edited" &&
      JSON.stringify(s.sub_steps.map((x) => x.name)) === JSON.stringify(ACTIONS) &&
      s.sub_steps.every((x) => x.state === "auto_suggested" && x.action_key && !x.draft_key && x.name_source === "action" && x.case_id === s.case_id)) &&
      valueFree;
    record("Open as a sub-process: every transaction's Save order gets one drafted sub-step per recorded action, named without the values typed, and is edited, on disk",
      !err && okDisk, JSON.stringify({ err, occurrences: occ.map((s) => [s.state, s.sub_steps.map((x) => x.name).join(" / ")]), valueFree }));
    const okLevel = !err && lv && JSON.stringify(lv.crumbs) === JSON.stringify(["Main process", SAVE]) && lv.dissolve &&
      lv.note === NOTE_LEVEL && lv.blocks.length === 4 &&
      lv.blocks.map((b) => b.title).join() === "Transaction 1,Transaction 2,Transaction 3,Transaction 4" &&
      lv.blocks[0].open && lv.blocks[0].badge === "Reference" && lv.blocks[0].status === "Draft" &&
      JSON.stringify(lv.blocks[0].rows) === JSON.stringify(ACTIONS) &&
      lv.blocks.slice(1).every((b) => !b.open && !b.badge && / · no differences$/.test(b.meta));
    record("the list shows the new level: the breadcrumb (Main process, Save order) with Dissolve sub-process, one block per visit, the reference transaction's open and marked, the others with no differences",
      okLevel, JSON.stringify(lv));
    if (!okLevel) await shot(page, "fail-subproc-level.png");
  }

  // ---- 2. A drafted sub-step renamed ---------------------------------------
  {
    let err = null;
    try {
      const row = openRow("Enter Quantity");
      await row.locator(".step-name").dblclick({ timeout: T });
      const input = page.locator("#step-list .step-name-edit");
      await input.fill(RENAMED, { timeout: T });
      await input.press("Enter");
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => opened(a).every((s) => s.sub_steps[1].name === RENAMED));
    const qs = opened(disk).map((s) => ({ run: s.case_id, name: s.sub_steps[1].name, state: s.sub_steps[1].state, src: s.sub_steps[1].name_source }));
    const store = fs.existsSync(STORE);
    const ref = qs.find((q) => q.run === R1) || {};
    const others = qs.filter((q) => q.run !== R1);
    const ok = !err && ref.name === RENAMED && ref.state === "edited" && others.length === 3 &&
      others.every((q) => q.name === RENAMED && q.state === "auto_suggested" && q.src === "remembered") && store === false;
    record("a drafted sub-step renamed: the other transactions' drafts of its action take the name (still drafts), and no remembered-names store is written (contract C21)",
      ok, JSON.stringify({ err, qs, store }));
  }

  // ---- 3. Up the breadcrumb, and back in by the row's button -----------------
  {
    let err = null, up = null, again = null, rowBtn = null;
    try {
      await page.locator("#steps-crumbs button.crumb").first().click({ timeout: T });
      await page.waitForSelector("#steps-crumbs", { state: "hidden", timeout: T });
      up = await level();
      rowBtn = ((await openRow(SAVE).locator(".step-sub-open").textContent({ timeout: T })) || "").trim();
      await openRow(SAVE).locator(".step-sub-open").click({ timeout: T });
      await page.waitForSelector("#steps-crumbs:not([hidden])", { timeout: T });
      again = await level();
      await page.locator("#steps-crumbs button.crumb").first().click({ timeout: T });
      await page.waitForSelector("#steps-crumbs", { state: "hidden", timeout: T });
    } catch (e) { err = errText(e); }
    const ok = !err && up && up.crumbs.length === 0 && up.selected === SAVE && up.blocks.length === 4 &&
      rowBtn === "▸ 6 sub-steps" && again && again.crumbs.length === 2 && again.blocks[0].open;
    record("the first crumb goes up (the step it was inside selected); the row's \"▸ 6 sub-steps\" opens the sub-process again",
      ok, JSON.stringify({ err, up: up && { crumbs: up.crumbs, selected: up.selected }, rowBtn, again: again && again.crumbs }));
  }

  // ---- 4. Group into a sub-process ------------------------------------------
  // Lane FX2 (validation pass 2, F5): first a Go to on transaction 2's first
  // Check document (back to its Save order), the step pane's real verb; the
  // Group below lifts it to that transaction's first group, and Dissolve
  // (5.) must give it back to Check, not to the group's last step.
  const LOOP_WHEN = "the check finds an error";
  const t2Steps = () => (readJson(ANNO).steps || []).filter((s) => s.case_id === R2)
    .sort((a, b) => Date.parse(a.time_range.start) - Date.parse(b.time_range.start) || (a.step_id < b.step_id ? -1 : 1));
  const CHECK_T2 = (t2Steps().find((s) => s.draft_key === K_CHECK) || {}).step_id;
  const SAVE_T2 = (t2Steps().find((s) => s.draft_key === K_SAVE) || {}).step_id;
  {
    let err = null;
    try {
      await openBlock(R2);
      await page.locator('#step-list .run-group.open .step-row[data-step-id="' + CHECK_T2 + '"]').click({ timeout: T });
      await page.click("#btn-flow-go-to");
      await page.selectOption("#flow-link-to-new", SAVE_T2);
      await page.waitForSelector("#flow-link-when-0", { timeout: T });
      await page.fill("#flow-link-when-0", LOOP_WHEN);
      await page.press("#flow-link-when-0", "Enter");
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => (a.steps || []).some((s) => s.step_id === CHECK_T2 && (s.links || []).some((l) => l.when === LOOP_WHEN)));
    const check = (disk.steps || []).find((s) => s.step_id === CHECK_T2) || {};
    record("lane FX2 setup: a Go to set in the step pane on transaction 2's first Check document, back to its Save order",
      !err && JSON.stringify(check.links) === JSON.stringify([{ to: SAVE_T2, when: LOOP_WHEN }]), JSON.stringify({ err, links: check.links }));
  }
  {
    let err = null, prompt = null, rowBtn = null;
    try {
      await openBlock(R1);
      await openRow("va01: Check document").locator(".multi-check").click({ timeout: T });
      await openRow("va01: Create sales order").locator(".multi-check").click({ timeout: T });
      await page.locator("#btn-group-selected").click({ timeout: T });
      await page.waitForSelector(".modal-backdrop.modal-prompt", { timeout: T });
      prompt = ((await page.locator(".modal-backdrop.modal-prompt .modal-detail").textContent()) || "").trim();
      await page.locator(".modal-backdrop.modal-prompt .modal-input").fill(GROUP);
      await page.locator(".modal-backdrop.modal-prompt .modal-ok").click({ timeout: T });
      await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .run-group.open .step-name")].some((e) => e.textContent.trim() === n), GROUP, { timeout: T });
      rowBtn = ((await openRow(GROUP).locator(".step-sub-open").textContent({ timeout: T })) || "").trim();
    } catch (e) { err = errText(e); }
    const disk = await waitDisk(ANNO, (a) => groups(a).length === 5);
    const gs = groups(disk);
    const perRun = RUNS.map((r) => gs.filter((g) => g.case_id === r).length);
    const ok = !err && gs.length === 5 && perRun.join() === "1,2,1,1" &&
      gs.every((g) => g.name === GROUP && g.state === "manually_authored" && !g.draft_key && g.system === "SAP" &&
        g.sub_steps.map((s) => s.draft_key).join() === K_CHECK + ",sapgui|va01|Button:create-sales-order") &&
      !(disk.steps || []).some((s) => s.draft_key === K_CHECK) && rowBtn === "▸ 2 sub-steps" &&
      // Lane FX2 (validation pass 2, F16): the prompt says exactly what the
      // Group will do, counted before it does it.
      prompt === "Groups these 2 steps and the same steps in 4 other places, in 3 transactions (5 groups). Ctrl+Z undoes it.";
    record("Group into a sub-process: two consecutive steps of the reference transaction, named (the prompt says what will happen: 4 other places, 3 transactions, 5 groups), and the same steps grouped in every transaction (transaction 2 twice), on disk",
      ok, JSON.stringify({ err, prompt, perRun, rowBtn, sample: gs[0] && { name: gs[0].name, state: gs[0].state, system: gs[0].system, subs: gs[0].sub_steps.map((s) => s.name) } }));
    if (!ok) await shot(page, "fail-subproc-group.png");
    const lifted = gs.find((g) => g.sub_steps.some((s) => s.step_id === CHECK_T2)) || {};
    record("lane FX2: Group lifts the Go to of transaction 2's Check to its group, and remembers the step it came from",
      JSON.stringify(lifted.links) === JSON.stringify([{ to: SAVE_T2, when: LOOP_WHEN, lifted_from: [CHECK_T2] }]),
      JSON.stringify({ links: lifted.links }));
  }

  // ---- 5. Dissolve both, and Undo ---------------------------------------------
  {
    let err = null, confirms = null;
    try {
      await openRow(GROUP).click({ timeout: T });
      await page.locator("#btn-step-dissolve").click({ timeout: T });
      await waitDisk(ANNO, (a) => groups(a).length === 0);
      confirms = await page.locator(".modal-backdrop.modal-confirm").count();
    } catch (e) { err = errText(e); }
    const gone = readJson(ANNO);
    const back = RUNS.map((r) => (gone.steps || []).filter((s) => s.case_id === r && s.draft_key === K_CHECK).length);
    // Lane FX2: the Go to is back on the step that carried it, Check, and
    // not on the group's last step, Create.
    const t2Gone = (gone.steps || []).filter((s) => s.case_id === R2);
    const checkBack = (t2Gone.find((s) => s.step_id === CHECK_T2) || {}).links;
    const createAfter = t2Gone.filter((s) => s.draft_key === "sapgui|va01|Button:create-sales-order").map((s) => s.links || null);
    let undone = null;
    try {
      await blur();
      await page.keyboard.press("Control+z");
      undone = await waitDisk(ANNO, (a) => groups(a).length === 5);
    } catch (e) { err = err || errText(e); }
    const ok = !err && confirms === 0 && groups(gone).length === 0 && back.join() === "1,2,1,1" && undone && groups(undone).length === 5;
    record("Dissolve the group (its step pane): no confirm, its steps back in their places in every transaction; Ctrl+Z brings the groups back",
      ok, JSON.stringify({ err, confirms, back, undone: undone && groups(undone).length }));
    const linkOk = JSON.stringify(checkBack) === JSON.stringify([{ to: SAVE_T2, when: LOOP_WHEN }]) &&
      createAfter.length === 2 && createAfter.every((l) => l === null) &&
      !!undone && groups(undone).some((g) => (g.links || []).some((l) => l.when === LOOP_WHEN));
    record("lane FX2: Group then Dissolve gives the Go to back to the step that carried it (transaction 2's Check), never to the group's last step; Ctrl+Z puts it back on the group",
      linkOk, JSON.stringify({ checkBack, createAfter }));
  }
  {
    let err = null, msg = null, after = null, undone = null;
    try {
      await openRow(SAVE).locator(".step-sub-open").click({ timeout: T });
      await page.waitForSelector("#steps-crumbs:not([hidden])", { timeout: T });
      await openRow("Enter Product code").click({ timeout: T });
      await page.locator("#step-desc").fill("Copy the product code from the customer's email.");
      await blur();
      await waitDisk(ANNO, (a) => opened(a).some((s) => s.case_id === R1 && /customer's email/.test(s.sub_steps[0].description)));
      await page.locator("#btn-dissolve-level").click({ timeout: T });
      await page.waitForSelector(".modal-backdrop.modal-confirm", { timeout: T });
      await wait(300);
      msg = ((await page.locator(".modal-backdrop.modal-confirm .modal-msg").textContent()) || "").trim();
      await page.locator(".modal-backdrop.modal-confirm .modal-ok").click({ timeout: T });
      after = await waitDisk(ANNO, (a) => opened(a).length === 0);
      await page.waitForSelector("#steps-crumbs", { state: "hidden", timeout: T });
      await blur();
      await page.keyboard.press("Control+z");
      undone = await waitDisk(ANNO, (a) => opened(a).length === 4);
    } catch (e) { err = errText(e); }
    const ok = !err && /loses its 24 steps in 4 transactions, with 1 description you wrote\.$/.test(msg || "") &&
      after && opened(after).length === 0 && (after.steps || []).filter((s) => s.draft_key === K_SAVE).length === 4 &&
      undone && opened(undone).length === 4 && opened(undone).every((s) => s.sub_steps.length === 6) &&
      /customer's email/.test((opened(undone).find((s) => s.case_id === R1) || { sub_steps: [{}] }).sub_steps[0].description || "");
    record("Dissolve the opened step (the breadcrumb): one confirm names the description written on a sub-step, the level goes up, and Ctrl+Z brings every sub-step back",
      ok, JSON.stringify({ err, msg, after: after && opened(after).length, undone: undone && opened(undone).map((s) => s.sub_steps.length) }));
    if (!ok) await shot(page, "fail-subproc-dissolve.png");
  }

  // ---- 6. Confirm transaction cascades ---------------------------------------
  {
    let err = null, status = null, again = null;
    try {
      await openBlock(R1);
      await page.locator('#step-list .run-group.open [data-act="confirm-run"]').click({ timeout: T });
      await waitDisk(ANNO, (a) => a.pattern_run && a.pattern_run.confirmed_at);
      await page.waitForFunction(() => /Confirmed/.test((document.querySelector("#step-list .run-group.pattern .run-status") || {}).textContent || ""), null, { timeout: T });
      status = "Confirmed";
    } catch (e) { err = errText(e); }
    const disk = readJson(ANNO);
    const t1 = opened(disk).find((s) => s.case_id === R1);
    const t2 = opened(disk).find((s) => s.case_id === R2);
    const t1Group = groups(disk).find((g) => g.case_id === R1);
    const okCascade = !err && t1 && t1.sub_steps.every((x) => x.state !== "auto_suggested") &&
      t1.sub_steps.filter((x) => x.state === "confirmed").length === 4 &&
      t1Group && t1Group.sub_steps.every((x) => x.state === "confirmed") &&
      t2 && t2.sub_steps.some((x) => x.state === "auto_suggested");
    record("Confirm transaction confirms the reference transaction's drafts at every level (the other transactions' stay drafts)",
      okCascade, JSON.stringify({ err, status, t1: t1 && t1.sub_steps.map((x) => x.state), group: t1Group && t1Group.sub_steps.map((x) => x.state) }));
    // A new sub-process drafted in the confirmed transaction: it reads Draft.
    try {
      await openRow("Excel - Order Tracking.xlsx: Save workbook").click({ timeout: T });
      await page.locator("#btn-step-make-sub").click({ timeout: T });
      await waitDisk(ANNO, (a) => (a.steps || []).some((s) => s.draft_key === K_EXCEL && Array.isArray(s.sub_steps)));
      await page.waitForSelector("#steps-crumbs:not([hidden])", { timeout: T });
      const inside = await level();
      await page.locator("#steps-crumbs button.crumb").first().click({ timeout: T });
      await page.waitForSelector("#steps-crumbs", { state: "hidden", timeout: T });
      const outside = await level();
      again = { inside: inside.blocks[0] && inside.blocks[0].status, outside: (outside.blocks.find((b) => b.badge) || {}).status,
        confirm: await page.locator('#step-list .run-group.pattern [data-act="confirm-run"]').count() };
    } catch (e) { err = errText(e); }
    const okDraft = !!again && again.inside === "Draft" && again.outside === "Draft" && again.confirm === 1;
    record("the confirmed reference transaction reads Draft again once a level holds drafts (a new sub-process), and offers Confirm transaction again",
      okDraft, JSON.stringify({ err, again }));
  }

  // ---- 7. The panel and the Timeline's steps lane follow the level ---------
  {
    let err = null, panel = null, lane = null, main = null;
    try {
      await openRow(SAVE).locator(".step-sub-open").click({ timeout: T });
      await page.waitForSelector("#steps-crumbs:not([hidden])", { timeout: T });
      await openRow("Enter Unit price").click({ timeout: T });
      // Plan D2: from 1440 px the row opens the panel beside the editor;
      // below, the row opens nothing and only Play opens it, in the place of
      // the step list (as panel-smoke opens it). This project has no video,
      // so the editor offers no Play button: the smoke calls what Play calls
      // (renderer.js watchStep: step-panel.js watch) on the selected step.
      const beside = await page.evaluate(() => require("./views/step-panel.js").standsBeside(window.innerWidth));
      if (!beside) {
        await page.waitForFunction(() => !!require("./state.js").getSelectedStepId(), null, { timeout: T });
        const opened = await page.evaluate(() => {
          const panelHidden = document.getElementById("step-panel").hidden;
          const id = require("./state.js").getSelectedStepId();
          const hit = require("./sub-process-maps.js").findStep(require("./state.js").getSession().annotations.steps, id);
          require("./views/step-panel.js").watch(hit && hit.step);
          return { rowOpenedNothing: panelHidden, step: !!hit };
        });
        if (!opened.rowOpenedNothing || !opened.step) throw new Error("below 1440 px: " + JSON.stringify(opened));
      }
      await page.waitForFunction(() => !document.getElementById("step-panel").hidden &&
        (document.getElementById("sp-name") || {}).textContent === "Enter Unit price", null, { timeout: T });
      panel = await page.evaluate(() => ({
        name: document.getElementById("sp-name").textContent,
        occ: document.querySelectorAll("#sp-body .sp-occ").length,
        explain: (document.getElementById("sp-explain") || {}).textContent || "",
      }));
      panel.opened = beside ? "row" : "play";
      // Below 1440 px Escape gives the step list back for the crumbs below.
      if (!beside) {
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.getElementById("step-panel").hidden, null, { timeout: T });
      }
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector('.tl-lane-name[data-lane="steps"]', { timeout: T });
      const subIds = new Set(opened(readJson(ANNO)).flatMap((s) => s.sub_steps.map((x) => x.step_id)));
      lane = await page.evaluate(() => ({
        name: document.querySelector('.tl-lane-name[data-lane="steps"]').textContent,
        ids: [...document.querySelectorAll(".tl-step-band")].map((b) => b.dataset.stepId),
      }));
      lane.allSub = lane.ids.length > 0 && lane.ids.every((id) => subIds.has(id));
      lane.count = lane.ids.length;
      delete lane.ids;
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      await page.locator("#steps-crumbs button.crumb").first().click({ timeout: T });
      await page.waitForSelector("#steps-crumbs", { state: "hidden", timeout: T });
      await page.locator('.view-mode-btn[data-level="flow"]').click({ timeout: T });
      await page.waitForSelector('.tl-lane-name[data-lane="steps"]', { timeout: T });
      main = await page.evaluate(() => document.querySelector('.tl-lane-name[data-lane="steps"]').textContent);
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
    } catch (e) {
      err = errText(e) + " " + JSON.stringify(await page.evaluate(() => ({
        selected: require("./state.js").getSelectedStepId(), play: !!document.querySelector("#step-detail #btn-step-watch"),
        panelHidden: document.getElementById("step-panel").hidden,
        spName: ((document.getElementById("sp-name") || {}).textContent || null),
      })).catch(() => null));
    }
    const okPanel = !err && panel && panel.name === "Enter Unit price" && panel.occ === 4 && /once in each transaction/.test(panel.explain);
    record("the step panel at a level: a sub-step's occurrences in every visit of its sub-process (plan D2: opened from its row from 1440 px; below, the row opening nothing, by what Play calls)",
      okPanel, JSON.stringify({ err, panel }));
    const okLane = !err && lane && lane.name === "Steps in " + SAVE && lane.allSub && lane.count >= 16 && main === "Steps";
    record("the Timeline's steps lane shows the level's steps and says so (\"Steps in <name>\"); back at the main level it reads Steps",
      okLane, JSON.stringify({ err, lane, main }));
    if (!okLane) await shot(page, "fail-subproc-lane.png");
  }

  // ---- 8. Help says how ------------------------------------------------------
  {
    const help = await page.evaluate(() => {
      const sec = document.querySelector('.help-section[data-section="stepsphases"]');
      const heads = sec ? [...sec.querySelectorAll("h3")].map((h) => h.textContent.trim()) : [];
      return { heads, text: sec ? sec.textContent : "" };
    });
    const ok = help.heads.includes("Sub-processes") && help.heads.includes("The flow of the steps") &&
      /Open as a sub-process/.test(help.text) && /Dissolve sub-process/.test(help.text) && /Only when/.test(help.text) && /Decision/.test(help.text);
    record("Help: one paragraph on sub-processes (make, open, dissolve) and one on the flow verbs (Only when, Decision)", ok, JSON.stringify(help.heads));
  }

  // ---- 9. The Map at a level (lane SUB-V2) -----------------------------------
  // The project now holds Save order (opened, "Enter Quantity" renamed), the
  // group and Excel's Save workbook (opened in step 6): four maps.
  const SUBS = ["Enter Product code", RENAMED, "Enter Unit price", "Enter Shipping address", "Enter Delivery method", "Click Save order"];
  const mapState = () => page.evaluate(() => {
    const cy = (document.getElementById("session-map-dfg-host") || {}).__cy;
    const bv = (document.getElementById("map-asis-canvas") || {}).__bpmnViewer;
    const root = bv ? bv.get("canvas").getRootElement() : null;
    const picker = document.getElementById("map-picker");
    return {
      path: require("./state.js").getMapPath(),
      picker: !!picker && !picker.hidden,
      name: ((document.getElementById("map-picker-name") || {}).textContent || "").trim(),
      items: [...document.querySelectorAll("#map-picker-popup .map-pick")].map((b) => ({
        num: ((b.querySelector(".map-pick-num") || {}).textContent || "").trim(),
        name: ((b.querySelector(".map-pick-name") || {}).textContent || "").trim(),
        depth: b.style.getPropertyValue("--map-depth").trim(), current: b.classList.contains("current") })),
      nodes: cy ? cy.nodes().filter((n) => n.data("kind") !== "event").map((n) => n.id()).sort() : null,
      marked: cy ? cy.nodes().filter((n) => n.data("sub")).map((n) => n.id()).sort() : null,
      asis: !document.getElementById("session-map-asis").hidden,
      root: root ? { id: root.id, name: (root.businessObject && root.businessObject.name) || "" } : null,
      // Lane MV: the header line names the picture shown.
      title: ((document.getElementById("map-view-title") || {}).textContent || "").trim(),
      why: document.getElementById("map-view-why").hidden ? null : document.getElementById("map-view-why").textContent,
    };
  });
  const pickMap = async (name) => {
    await page.locator("#btn-map-picker").click({ timeout: T });
    await page.locator("#map-picker-popup .map-pick").filter({
      has: page.locator(".map-pick-name", { hasText: new RegExp("^" + esc(name) + "$") }),
    }).first().click({ timeout: T });
    await page.waitForFunction((n) => (document.getElementById("map-picker-name") || {}).textContent === n, name, { timeout: T });
    await wait(600);
  };
  const saveVia = async (item, out) => {
    await app.evaluate(({ dialog, shell }, f) => {
      global.__pdtSaveDefault = null; global.__pdtRevealed = null;
      dialog.showSaveDialog = async (_w, o) => { global.__pdtSaveDefault = (o && o.defaultPath) || null; return { canceled: false, filePath: f }; };
      shell.showItemInFolder = (p) => { global.__pdtRevealed = p; };
    }, out);
    await page.locator("#btn-session-export-menu").click({ timeout: T });
    await page.locator(item).click({ timeout: T });
    const by = Date.now() + 180000;
    while (Date.now() < by && !(fs.existsSync(out) && fs.statSync(out).size > 0)) await wait(250);
    await wait(500);
    return {
      suggested: path.basename((await app.evaluate(() => global.__pdtSaveDefault)) || ""),
      revealed: path.resolve((await app.evaluate(() => global.__pdtRevealed)) || ".").toLowerCase() === path.resolve(out).toLowerCase(),
      // Lane FX3: exports are offered under the project's name.
      base: await page.evaluate(() => {
        const s = require("./state.js").getSession();
        return require("./session-summary.js").exportBaseName(s, require("path").basename(s.sessionFolder));
      }),
    };
  };
  const TMP_OUT = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-subproc-out-"));
  const EXCEL = "Excel" + " " + String.fromCharCode(45) + " " + "Order Tracking.xlsx: Save workbook";
  {
    let err = null, main = null, sub = null, dbl = null, steps = null, first = null, plane = null;
    try {
      await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
      await page.waitForFunction(() => !document.getElementById("map-picker").hidden, null, { timeout: T });
      // Lane MV: the Map opens on the process map (analyzed first: the steps
      // changed since), on its main plane.
      await mapSettled(page);
      await page.waitForSelector("#map-asis-canvas .djs-container > svg", { timeout: T });
      await wait(400);
      first = await mapState();
      // The checks below read the live map's boxes: how the transactions ran.
      await page.locator("#btn-map-show-runs").click({ timeout: T });
      await page.waitForFunction(() => { const h = document.getElementById("session-map-dfg-host"); return !!(h && h.__cy && h.getClientRects().length); }, null, { timeout: T });
      await page.locator("#btn-map-picker").click({ timeout: T });
      main = await mapState();
      await page.locator("#btn-map-picker").click({ timeout: T });
      await pickMap(SAVE);
      sub = await mapState();
      await shot(page, "subproc-map-level.png");
      await page.locator('.view-mode-btn[data-level="steps"]').click({ timeout: T });
      await page.waitForSelector("#steps-crumbs:not([hidden])", { timeout: T });
      steps = await level();
      await page.locator('.view-mode-btn[data-level="map"]').click({ timeout: T });
      await pickMap("Main process");
      // A double-click on a marked box opens its map.
      await page.evaluate((n) => { document.getElementById("session-map-dfg-host").__cy.getElementById(n).emit("dbltap"); }, GROUP);   // a block body: returning the collection hangs CI (BH13)
      await page.waitForFunction((n) => (document.getElementById("map-picker-name") || {}).textContent === n, GROUP, { timeout: T });
      await wait(600);
      dbl = await mapState();
      // Lane MV: the process map again, with Save order chosen: the step
      // BPMN's plane of it.
      await pickMap(SAVE);
      await page.locator("#btn-map-show-map").click({ timeout: T });
      await mapSettled(page);
      await page.waitForFunction((n) => {
        const bv = (document.getElementById("map-asis-canvas") || {}).__bpmnViewer;
        const r = bv && bv.get("canvas").getRootElement();
        return !!(r && /_plane$/.test(r.id) && r.businessObject && r.businessObject.name === n);
      }, SAVE, { timeout: T });
      plane = await mapState();
      await shot(page, "subproc-map-step-plane.png");
    } catch (e) { err = errText(e); }
    const okFirst = !err && !!first && first.asis && first.title === "Process map" && !!first.root && !/_plane$/.test(first.root.id);
    const okPlane0 = !err && !!plane && plane.asis && plane.title === "Process map" && JSON.stringify(plane.path) === JSON.stringify([SAVE]) &&
      !plane.why && !!plane.root && plane.root.name === SAVE && /_plane$/.test(plane.root.id);
    record("lane MV: the Map opens on the process map (the step BPMN drawn by bpmn-js, its main plane), and with Save order chosen shows the step BPMN's plane of it",
      okFirst && okPlane0,
      JSON.stringify({ err, first: first && { asis: first.asis, title: first.title, root: first.root }, plane: plane && { asis: plane.asis, title: plane.title, path: plane.path, root: plane.root, why: plane.why } }));
    const okPicker = !err && main && main.picker && main.name === "Main process" &&
      JSON.stringify(main.items.map((i) => [i.num, i.name, i.depth, i.current])) ===
        JSON.stringify([["", "Main process", "0", true], ["3", SAVE, "1", false], ["4", GROUP, "1", false], ["5", EXCEL, "1", false]]) &&
      JSON.stringify(main.marked) === JSON.stringify([SAVE, GROUP, EXCEL].sort());
    record("the Map's picker lists every map after Open as a sub-process: Main process, then each sub-process indented with its number; the live map marks the sub-processes' boxes",
      okPicker, JSON.stringify({ err, main: main && { name: main.name, items: main.items, marked: main.marked } }));
    const okLive = !err && sub && JSON.stringify(sub.path) === JSON.stringify([SAVE]) && sub.name === SAVE &&
      JSON.stringify(sub.nodes) === JSON.stringify(SUBS.slice().sort()) && sub.marked.length === 0 &&
      steps && JSON.stringify(steps.crumbs) === JSON.stringify(["Main process", SAVE]) &&
      dbl && JSON.stringify(dbl.path) === JSON.stringify([GROUP]) && JSON.stringify(dbl.nodes) === JSON.stringify(["va01: Check document", "va01: Create sales order"]);
    record("choosing Save order draws its live map (its boxes are its sub-steps) and Steps shows the same level; a double-click on a marked box opens its map",
      okLive, JSON.stringify({ err, sub: sub && { path: sub.path, nodes: sub.nodes }, crumbs: steps && steps.crumbs, dbl: dbl && { path: dbl.path, nodes: dbl.nodes } }));
    if (!okLive) await shot(page, "fail-subproc-map-live.png");
  }
  {
    // Export, Process map (image) with a sub-process chosen: that map, drawn
    // from the step BPMN (no As-Is copy yet), named after its number.
    let err = null, r = null, svg = "";
    const out = path.join(TMP_OUT, "sub.svg");
    try {
      await pickMap(SAVE);
      r = await saveVia("#btn-session-map-svg", out);
      svg = fs.existsSync(out) ? fs.readFileSync(out, "utf-8") : "";
    } catch (e) { err = errText(e); }
    const ids = [...svg.matchAll(/data-element-id="([^"]+)"/g)].map((m) => m[1]);
    const sub = ids.filter((i) => /^Sub\d+_/.test(i));
    const ok = !err && /created with bpmn-js/.test(svg) && sub.length > 0 && ids.every((i) => /^Sub\d+_/.test(i)) &&
      !!r.base && r.suggested === r.base + " map of sub-process 3.svg" && r.revealed;
    record("Export, Process map (image), with Save order chosen, saves its plane of the step BPMN (only that plane's elements), offered as \"<project> map of sub-process 3.svg\", and opens its folder at the file",
      ok, JSON.stringify({ err, r, ids: ids.length, sub: sub.length, sample: ids.slice(0, 3) }));
  }
  {
    // An As-Is copy made after the sub-process has its plane: the picker
    // shows it, a task there opens the panel at that level, and bpmn-js's own
    // drill down keeps the picker in step.
    let err = null, shown = null, panel = null, up = null, down = null, r = null, svg = "";
    try {
      await page.locator("#btn-fork-refmap").click({ timeout: T });
      await page.waitForSelector("#refmap-editor-overlay", { state: "visible", timeout: 120000 });
      await page.waitForSelector("#refmap-editor-host .djs-container", { timeout: T });
      await wait(800);
      // Lane MV: a new copy is kept at its first change (here the main map's
      // legend moved a little).
      await page.evaluate(() => {
        const ed = document.getElementById("refmap-editor-host").__bpmnViewer;
        ed.get("modeling").moveElements([ed.get("elementRegistry").filter((e) => /^(?:Sub\d+_)?TextAnnotation_system/.test(e.id))[0]], { x: 0, y: 8 });
      });
      await wait(1400);
      await page.locator("#btn-refmap-editor-close").click({ timeout: T });
      // The canvas's own svg (the drill down arrows' icons come first in the page).
      await page.waitForSelector("#map-asis-canvas .djs-container > svg", { timeout: T });
      await pickMap("Main process");
      await pickMap(SAVE);
      await page.waitForFunction(() => {
        const bv = document.getElementById("map-asis-canvas").__bpmnViewer;
        return !!bv && /_plane$/.test(bv.get("canvas").getRootElement().id);
      }, null, { timeout: T });
      shown = await mapState();
      await shot(page, "subproc-map-asis-plane.png");
      const task = await page.evaluate(() => {
        const bv = document.getElementById("map-asis-canvas").__bpmnViewer;
        const root = bv.get("canvas").getRootElement();
        const el = bv.get("elementRegistry").filter((e) => e.parent === root && e.businessObject &&
          e.businessObject.$instanceOf("bpmn:Task") && e.businessObject.name === "Enter Unit price")[0];
        return el ? el.id : null;
      });
      await page.click('#map-asis-canvas .djs-element[data-element-id="' + task + '"]', { timeout: T });
      await page.waitForFunction(() => (document.getElementById("sp-name") || {}).textContent === "Enter Unit price", null, { timeout: T });
      panel = await page.evaluate(() => ({ occ: document.querySelectorAll("#sp-body .sp-occ").length,
        explain: (document.getElementById("sp-explain") || {}).textContent || "" }));
      await page.locator("#btn-sp-close").click({ timeout: T });
      await page.locator("#map-asis-canvas .bjs-breadcrumbs .bjs-crumb a").first().click({ timeout: T });
      await page.waitForFunction(() => (document.getElementById("map-picker-name") || {}).textContent === "Main process", null, { timeout: T });
      up = await mapState();
      const arrow = await page.evaluate((n) => {
        const bv = document.getElementById("map-asis-canvas").__bpmnViewer;
        const sp = bv.get("elementRegistry").filter((e) => e.type === "bpmn:SubProcess" && e.businessObject.name === n)
          .find((e) => bv.get("canvas").findRoot(e.id + "_plane"));
        return sp ? sp.id : null;
      }, GROUP);
      await page.locator('#map-asis-canvas .djs-overlays[data-container-id="' + arrow + '"] .bjs-drilldown').click({ timeout: T });
      await page.waitForFunction((n) => (document.getElementById("map-picker-name") || {}).textContent === n, GROUP, { timeout: T });
      down = await mapState();
      // Export, Process map (image) now saves the As-Is copy's plane.
      await pickMap(SAVE);
      r = await saveVia("#btn-session-map-svg", path.join(TMP_OUT, "asis-sub.svg"));
      svg = fs.existsSync(path.join(TMP_OUT, "asis-sub.svg")) ? fs.readFileSync(path.join(TMP_OUT, "asis-sub.svg"), "utf-8") : "";
    } catch (e) { err = errText(e); }
    const okPlane = !err && shown && shown.asis && shown.title === "As-Is map" && shown.root && shown.root.name === SAVE && /_plane$/.test(shown.root.id) &&
      panel && panel.occ === 4 && /once in each transaction/.test(panel.explain);
    record("an As-Is copy made after the sub-process shows Save order's plane when the picker chooses it, and a task there opens the panel on its sub-step (4 occurrences)",
      okPlane, JSON.stringify({ err, root: shown && shown.root, asis: shown && shown.asis, title: shown && shown.title, panel }));
    if (!okPlane) await shot(page, "fail-subproc-map-asis.png");
    const okDrill = !err && up && JSON.stringify(up.path) === "[]" && up.root && !/_plane$/.test(up.root.id) &&
      down && JSON.stringify(down.path) === JSON.stringify([GROUP]) && down.root && down.root.name === GROUP &&
      r && !!r.base && r.suggested === r.base + " As-Is map of sub-process 3.svg" && r.revealed && /created with bpmn-js/.test(svg) &&
      [...svg.matchAll(/data-element-id="([^"]+)"/g)].every((m) => /^Sub\d+_/.test(m[1]));
    record("bpmn-js's own drill down (a crumb up, the arrow on the group) keeps the picker and the level in step; the image export then saves the As-Is copy's plane (<project> As-Is map of sub-process 3.svg)",
      okDrill, JSON.stringify({ err, up: up && { path: up.path, root: up.root }, down: down && { path: down.path, root: down.root }, r }));
  }
  {
    // The PDD: a picture of each sub-process's map with its chapter.
    let err = null, descr = null;
    try {
      const out = path.join(TMP_OUT, "pdd.docx");
      await saveVia("#btn-session-pdd", out);
      const xml = zipFiles(fs.readFileSync(out))["word/document.xml"].toString("utf8");
      descr = [...xml.matchAll(/descr="([^"]+)"/g)].map((m) => m[1]);
    } catch (e) { err = errText(e); }
    const ok = !err && descr && ["As-Is process map", "As-Is process map, sub-process 3", "As-Is process map, sub-process 4",
      "As-Is process map, sub-process 5"].every((d) => descr.includes(d));
    record("the exported PDD carries the main map's picture and one per sub-process chapter (alt text \"As-Is process map, sub-process <n>\")",
      ok, JSON.stringify({ err, descr }));
  }
  try { fs.rmSync(TMP_OUT, { recursive: true, force: true }); } catch (_) { /* temp */ }

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.length + " error(s): " + pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-subproc-page-errors.png");

  await viewer.close();
  try { fs.rmSync(SESSION, { recursive: true, force: true }); } catch (_) { /* temp */ }
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n[subprocess-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[subprocess-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[subprocess-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
