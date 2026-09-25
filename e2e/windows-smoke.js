"use strict";
/*
 * Several windows e2e smoke (lane MW). Launches the REAL viewer on a
 * throwaway profile with project A (a temp copy of the demo session
 * sess-2026-0514-0900, its document titled "Order entry") and has project B
 * (a temp copy of sess-2026-0515-0840, "Invoice check"), both analyzed with
 * the current pipeline, and works with several projects at once:
 *   (a) Open, Open in a new window... answers B: a second window opens B and
 *       the first keeps A; each window is named after its project, and each
 *       project saves from its own window;
 *   (b) the new-window button beside A among the Open menu's recent projects
 *       opens A in a third window, read only: the project line "Open in
 *       another window: read only here", the save state "Read only", no
 *       editing control, no hand-off files in Export, and the main process
 *       refuses a save from that window while A's own window still saves;
 *   (c) a second start of the viewer on the same profile, with
 *       --session=<B>, ends at once and opens B in a new window of the
 *       running viewer, read only there (the second window edits B);
 *   (d) closing A's first window closes A there only: the other windows keep
 *       their projects, and A opened again in a new window opens for
 *       editing, since no window holds it any more;
 *   (e) closing every window ends the viewer, and nothing was left in A's or
 *       B's folder beyond the backups the saves made: no lock of any kind.
 * No native window opens: every dialog and shell opener of the main process
 * is answered before anything is clicked, and any call not expected fails a
 * check. Every page.evaluate returns plain data (BH13). With
 * PDT_WINDOWS_SHOTS set to a folder, the Open menu and the read-only line
 * are saved there, light and dark. Zero page errors. Exits 0 when every
 * check passed, 1 on a failed check, 2 when it could not run.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, spawnSync, execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const DEMO = path.join(REPO, "sessions", "example-aggregate");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const T = 20000;
const ELSEWHERE_LINE = "Open in another window: read only here";
const SHOTS = process.env.PDT_WINDOWS_SHOTS || "";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* The page in light and dark, as <stem>-light.png and <stem>-dark.png. */
async function shotsBothThemes(page, stem) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { require("./theme.js").setTheme(t); return true; }, theme);
    await wait(250);
    await page.screenshot({ path: path.join(SHOTS, stem + "-" + theme + ".png") }).catch((e) => console.log("shot fail", stem, e.message));
  }
  await page.evaluate(() => { require("./theme.js").setTheme("light"); return true; });
}
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("windows-smoke", e); return String((e && e.message) || e).split("\n")[0]; };

/* A demo session copied to temp, its document titled `title`, analyzed with
   the current pipeline (so no window analyzes it as it opens). */
function freshProject(base, session, name, title) {
  const folder = path.join(base, name);
  fs.mkdirSync(folder);
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) {
    const s = path.join(DEMO, session, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(folder, f));
  }
  const annoPath = path.join(folder, "annotations.json");
  const anno = JSON.parse(fs.readFileSync(annoPath, "utf-8"));
  anno.document = Object.assign({}, anno.document || {}, { title });
  fs.writeFileSync(annoPath, JSON.stringify(anno, null, 2));
  const bundled = path.join(VIEWER, "python", "python.exe");
  for (const py of fs.existsSync(bundled) ? [bundled] : ["python", "python3"]) {
    try {
      execFileSync(py, [path.join(REPO, "normalization", "normalize.py"), folder, "--mine"], { cwd: REPO, stdio: "ignore" });
      return folder;
    } catch (_) { /* the next interpreter */ }
  }
  return null;
}

/* The names of the files and folders under `root`, relative. */
function names(root) {
  const out = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      out.push(rel + e.name + (e.isDirectory() ? "/" : ""));
      if (e.isDirectory()) walk(path.join(dir, e.name), rel + e.name + "/");
    }
  })(root, "");
  return out.sort();
}

/* Every native dialog and shell opener answered before anything is clicked:
   an open dialog gives the next folder queued in global.__answers, anything
   else is recorded as unexpected. Set once: the main process is shared by
   every window. */
async function guardNativeWindows(app) {
  await app.evaluate(({ dialog, shell }) => {
    global.__unexpected = [];
    global.__answers = [];
    const note = (kind, args) => {
      const o = args.find((a) => a && typeof a === "object" && typeof a.isDestroyed !== "function") || {};
      global.__unexpected.push(kind + (o.title ? ": " + o.title : o.message ? ": " + o.message : ""));
      return o;
    };
    dialog.showOpenDialog = async (...a) => {
      const next = global.__answers.shift();
      if (next) return { canceled: false, filePaths: [next] };
      note("open dialog", a);
      return { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async (...a) => { note("save dialog", a); return { canceled: true, filePath: "" }; };
    dialog.showMessageBox = async (...a) => {
      const o = note("message box", a);
      return { response: typeof o.cancelId === "number" ? o.cancelId : 0, checkboxChecked: false };
    };
    dialog.showOpenDialogSync = (...a) => { note("open dialog", a); return undefined; };
    dialog.showSaveDialogSync = (...a) => { note("save dialog", a); return undefined; };
    dialog.showMessageBoxSync = (...a) => { const o = note("message box", a); return typeof o.cancelId === "number" ? o.cancelId : 0; };
    dialog.showErrorBox = (...a) => { note("error box", [{ title: a[0] }]); };
    shell.openPath = async (f) => { note("open " + f, []); return ""; };
    shell.showItemInFolder = (f) => { note("Explorer at " + f, []); };
    shell.openExternal = async (u) => { note("open " + u, []); };
    return true;
  });
}
async function nativeCheck(app, label) {
  const calls = await app.evaluate(() => (global.__unexpected || []).slice()).catch((e) => ["(could not read: " + e.message + ")"]);
  record(label + ": no native dialog or window was asked for beyond the ones this smoke answers", calls.length === 0,
    calls.slice(0, 4).join(" | "));
}

/* What a window shows: plain data (BH13). */
const view = (page) => page.evaluate(() => {
  const s = require("./state.js").getSession();
  const app = document.querySelector(".app");
  const line = document.getElementById("ov-elsewhere");
  const save = document.getElementById("save-state");
  return {
    folder: s ? s.sessionFolder : null,
    readOnly: !!(s && s.readOnly === true),
    elsewhere: !!(s && s.openElsewhere === true),
    appReadOnly: app.classList.contains("read-only"),
    appElsewhere: app.classList.contains("open-elsewhere"),
    line: line ? line.textContent : null,
    lineShown: !!(line && line.getClientRects().length),
    save: save ? save.textContent : null,
    saveState: save ? save.dataset.state : null,
    saveTitle: save ? save.title : null,
    title: document.title,
  };
});

/* A save of the project on screen, straight to the main process (the sink
   that holds when a control slips through): { ok, code, error }. */
const saveFromWindow = (page) => page.evaluate(async () => {
  const s = require("./state.js").getSession();
  const r = await require("./ipc.js").saveAnnotations({ sessionFolder: s.sessionFolder, annotations: s.annotations });
  return { ok: !!(r && r.ok), code: (r && r.code) || null, error: (r && r.error) || null };
});

/* Controls that change a project: none may show in a window that has its
   project read only (the Overview's and the top bar's; the hand-off smoke
   walks every level). */
const EDITING = ["#btn-session-pdd", "#btn-session-tech", "#btn-session-zip", "#btn-session-handoff",
  "#ov-next", "#btn-attach-video", "#btn-attach-transcript", "#btn-ov-attach", ".summary-fix",
  "#btn-handoff-open-pdd", "#btn-handoff-open-tech"];
const visibleOf = (page, sels) => page.evaluate((list) => list.filter((s) =>
  Array.from(document.querySelectorAll(s)).some((el) => el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden")), sels);

/* Open the Open menu of `page` and click the new-window button beside the
   recent project `folder` (the menu saved as `stem` first, with
   PDT_WINDOWS_SHOTS). */
async function newWindowFromRecent(page, folder, stem) {
  await page.click("#btn-recent-menu");
  await page.waitForSelector("#recent-menu-popup .recent-menu-newwin", { state: "visible", timeout: T });
  const i = await page.evaluate((f) => Array.from(document.querySelectorAll("#recent-menu-content .recent-menu-newwin"))
    .findIndex((b) => b.dataset.folder === f), folder);
  if (i < 0) throw new Error("no new-window button beside " + folder + " in the Open menu");
  const btn = page.locator("#recent-menu-content .recent-menu-newwin").nth(i);
  if (stem) { await btn.hover(); await shotsBothThemes(page, stem); }
  await btn.click();
}

(async () => {
  const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-windows-e2e-"));
  const A = freshProject(BASE, "sess-2026-0514-0900", "order-entry", "Order entry");
  const B = A && freshProject(BASE, "sess-2026-0515-0840", "invoice-check", "Invoice check");
  if (!A || !B) { console.log("[windows-e2e] FATAL: no Python with the pipeline dependencies"); process.exit(2); }
  const before = { A: names(A), B: names(B) };
  const errs = [];
  const watch = (page, tag) => {
    page.on("console", (m) => { if (m.type() === "error") errs.push(tag + ": " + m.text()); });
    page.on("pageerror", (e) => errs.push(tag + ": " + String(e && e.message ? e.message : e)));
  };
  const loaded = async (page, folder) => {
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
    await page.waitForFunction((f) => { const s = require("./state.js").getSession(); return !!(s && s.sessionFolder === f); },
      folder, { timeout: T });
  };
  const count = () => v.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  let v, w1;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + A], cwd: VIEWER });
    await guardNativeWindows(v.app);
    w1 = await v.app.firstWindow();
    watch(w1, "window 1");
    await loaded(w1, A);
  } catch (e) { console.error("[windows-e2e] FATAL:", e); process.exit(2); }
  const answer = (f) => v.app.evaluate((_e, p) => { global.__answers.push(p); return true; }, f);

  /* ---- (a) Open in a new window...: B beside A ---- */
  let w2 = null;
  try {
    await w1.click("#btn-recent-menu");
    const item = await w1.waitForSelector("#btn-open-new-window", { state: "visible", timeout: T });
    record("(a) the Open menu has Open in a new window..., after Open project...",
      (await item.textContent()) === "Open in a new window..." &&
      (await w1.evaluate(() => document.getElementById("btn-open-session").nextElementSibling.id)) === "btn-open-new-window");
    await answer(B);
    const next = v.app.waitForEvent("window", { timeout: T });
    await item.click();
    w2 = await next;
    watch(w2, "window 2");
    await loaded(w2, B);
    const one = await view(w1), two = await view(w2);
    record("(a) a second window opens B, for editing", two.folder === B && !two.readOnly && !two.appReadOnly && !two.lineShown,
      JSON.stringify(two));
    record("(a) the first window keeps A, for editing", one.folder === A && !one.readOnly && !one.appReadOnly,
      JSON.stringify(one));
    record("(a) each window is named after its project",
      one.title === "Order entry · Process Discovery Viewer" && two.title === "Invoice check · Process Discovery Viewer",
      one.title + " / " + two.title);
    record("(a) two windows are open", (await count()) === 2);
    const s1 = await saveFromWindow(w1), s2 = await saveFromWindow(w2);
    record("(a) each project saves from its own window", s1.ok && s2.ok, JSON.stringify([s1, s2]));
  } catch (e) { record("(a) Open in a new window...", false, errText(e)); }
  await nativeCheck(v.app, "(a)");

  /* ---- (b) A again, from the recent projects: read only in a third window ---- */
  let w3 = null;
  try {
    const next = v.app.waitForEvent("window", { timeout: T });
    await newWindowFromRecent(w2, A, "windows-open-menu");
    w3 = await next;
    watch(w3, "window 3");
    await loaded(w3, A);
    await w3.waitForSelector("#ov-elsewhere", { state: "visible", timeout: T });
    await shotsBothThemes(w3, "windows-read-only");
    const three = await view(w3);
    record("(b) the third window opens A read only: another window has it open for editing",
      three.folder === A && three.readOnly && three.elsewhere && three.appReadOnly && three.appElsewhere, JSON.stringify(three));
    record("(b) its project line says: " + ELSEWHERE_LINE, three.line === ELSEWHERE_LINE && three.lineShown, three.line);
    record("(b) its save state reads Read only, and says why",
      three.save === "Read only" && three.saveState === "readonly" && /^Open in another window: read only here\./.test(three.saveTitle),
      three.saveTitle);
    record("(b) its window's name says read only", three.title === "Order entry (read only) · Process Discovery Viewer", three.title);
    await w3.click("#btn-session-export-menu");
    await w3.waitForSelector("#session-export-popup", { state: "visible", timeout: T });
    const shown = await visibleOf(w3, EDITING);
    record("(b) no control that changes the project shows", shown.length === 0, shown.join(", "));
    const items = await w3.evaluate(() => Array.from(document.querySelectorAll("#session-export-popup .project-menu-item"))
      .filter((b) => b.getClientRects().length > 0).map((b) => b.textContent));
    record("(b) Export offers the map exports only: no hand-off files, nothing that writes the project",
      JSON.stringify(items) === JSON.stringify(["Process map (image)", "Process map (BPMN)"]), JSON.stringify(items));
    await w3.keyboard.press("Escape");
    // Steps: the reference transaction is said as it is, never as a version handed off.
    await w3.click(".view-mode-btn[data-level=\"steps\"]");
    const head = "#step-list .run-group.pattern .run-row";
    await w3.waitForSelector(head, { timeout: T });
    if ((await w3.getAttribute(head, "aria-expanded")) !== "true") await w3.click(head);   // a click toggles it
    await w3.waitForFunction(() => /reference transaction/.test((document.querySelector("#step-detail .run-guide") || {}).textContent || ""),
      null, { timeout: T }).catch(() => {});
    const guide = await w3.evaluate(() => (document.querySelector("#step-detail .run-guide") || {}).textContent || "");
    record("(b) Steps says what shows, as for a project not handed off",
      guide.includes("This is the reference transaction. It is not confirmed yet.") && !/handed off/.test(guide), guide);
    await w3.click(".view-mode-btn[data-level=\"overview\"]");
    const refused = await saveFromWindow(w3);
    record("(b) the main process refuses a save from the read-only window",
      !refused.ok && refused.code === "READ_ONLY" && /open in another window/.test(refused.error || ""), JSON.stringify(refused));
    const still = await saveFromWindow(w1);
    record("(b) A's own window still saves", still.ok, JSON.stringify(still));
    record("(b) three windows are open", (await count()) === 3);
  } catch (e) { record("(b) A in a third window", false, errText(e)); }
  await nativeCheck(v.app, "(b)");

  /* ---- (c) a second start of the viewer: a new window here, then it ends ---- */
  let w4 = null;
  try {
    const next = v.app.waitForEvent("window", { timeout: T });
    const second = spawn(electronPath, [".", "--user-data-dir=" + v.profileDir, "--session=" + B],
      { cwd: VIEWER, stdio: "ignore", windowsHide: true });
    const exit = await Promise.race([
      new Promise((r) => second.on("exit", (code) => r({ code }))),
      wait(30000).then(() => null),
    ]);
    if (!exit) spawnSync("taskkill", ["/pid", String(second.pid), "/T", "/F"], { stdio: "ignore" });
    record("(c) a second start of the viewer on the same profile ends at once", !!exit, JSON.stringify(exit));
    w4 = await next;
    watch(w4, "window 4");
    await loaded(w4, B);
    await w4.waitForSelector("#ov-elsewhere", { state: "visible", timeout: T });
    const four = await view(w4);
    record("(c) it opens B in a new window of the running viewer, read only (window 2 edits B)",
      four.folder === B && four.readOnly && four.elsewhere && four.line === ELSEWHERE_LINE, JSON.stringify(four));
    record("(c) four windows are open", (await count()) === 4);
  } catch (e) { record("(c) a second start of the viewer", false, errText(e)); }
  await nativeCheck(v.app, "(c)");

  /* ---- (d) closing A's first window closes A there only ---- */
  let w5 = null;
  try {
    const gone = w1.waitForEvent("close", { timeout: T });
    await w1.evaluate(() => { window.close(); return true; });
    await gone;
    record("(d) closing the first window leaves three", (await count()) === 3);
    const two = await view(w2), three = await view(w3), four = await view(w4);
    record("(d) the other windows keep their projects",
      two.folder === B && !two.readOnly && three.folder === A && three.readOnly && four.folder === B && four.readOnly,
      JSON.stringify([two.folder, two.readOnly, three.folder, three.readOnly, four.folder, four.readOnly]));
    const next = v.app.waitForEvent("window", { timeout: T });
    await newWindowFromRecent(w2, A);
    w5 = await next;
    watch(w5, "window 5");
    await loaded(w5, A);
    const five = await view(w5);
    record("(d) A opened again in a new window opens for editing: no window holds it any more",
      five.folder === A && !five.readOnly && !five.appReadOnly && !five.lineShown && five.save === "Saved", JSON.stringify(five));
    const s5 = await saveFromWindow(w5);
    record("(d) and it saves", s5.ok, JSON.stringify(s5));
  } catch (e) { record("(d) closing a window", false, errText(e)); }
  await nativeCheck(v.app, "(d)");

  /* ---- (e) the last window ends the viewer; no lock is left ---- */
  try {
    const proc = v.app.process();
    const ended = new Promise((r) => { if (proc.exitCode !== null) r(true); else proc.once("exit", () => r(true)); });
    for (const w of [w2, w3, w4, w5]) {
      if (!w || w.isClosed()) continue;
      const gone = w.waitForEvent("close", { timeout: T });
      await w.evaluate(() => { window.close(); return true; }).catch(() => { /* the viewer may end meanwhile */ });
      await gone.catch(() => {});
    }
    const exited = await Promise.race([ended, wait(20000).then(() => false)]);
    record("(e) closing the last window ends the viewer", exited === true);
    const added = (k, dir) => names(dir).filter((n) => !before[k].includes(n));
    const extra = added("A", A).concat(added("B", B));
    record("(e) nothing is left in the project folders beyond the saves' backups: no lock",
      extra.every((n) => /^annotations\.json\.[2-5]$/.test(n)) && !names(A).concat(names(B)).some((n) => /lock/i.test(n)),
      extra.join(", "));
  } catch (e) { record("(e) closing every window", false, errText(e)); }

  record("zero page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  await v.close();
  try { fs.rmSync(BASE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* temp */ }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[windows-e2e] ${passed}/${results.length} checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("[windows-e2e] crash:", e && e.stack ? e.stack : e); process.exit(2); });
