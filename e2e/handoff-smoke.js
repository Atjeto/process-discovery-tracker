"use strict";
/*
 * Hand-off e2e smoke (lane HV, contract C20). Launches the REAL viewer on a
 * throwaway profile against a TEMP copy of the committed demo session
 * sess-2026-0514-0900 (its document titled "Order entry"), analyzed with the
 * current pipeline, and hands it over the way the analyst does:
 *   (a) Export, Hand off...: one dialog, "What changed in this version?",
 *       filled with "First hand-off"; "Order entry v1.zip" is made next to
 *       the project folder and shown in its folder; it holds the project
 *       folder (its annotations.json with the version entry) and, at its
 *       root, "Order entry v1 PDD.docx" (Document control reads "Version 1,
 *       handed off <date> by <user>" over a Version history table of one
 *       row) and "Order entry v1 Technical details.xlsx" (its five sheets);
 *   (b) a second hand-off: the dialog starts empty and OK waits for a note;
 *       "Order entry v2.zip" with two rows in its PDD's table; Ctrl+Z takes
 *       version 2 back (the zip stays), Ctrl+Y brings it again;
 *   (c) between hand-offs, Export's PDD reads "Working copy after version 2"
 *       and Technical details (.xlsx) writes the workbook on its own;
 *   (d) a developer's viewer (another profile) opens the v2 zip with Open a
 *       hand-off (.zip): extracted under its userData and opened read only: the
 *       project line "Version 2, handed off <date> by <user> · Read only",
 *       the save state "Read only", no editing control on any level, the
 *       fields read only, no shortcut, right-click or double-click changing
 *       anything, no analysis, Export opening the PDD the zip came with;
 *       nothing is written to disk (the extracted folder byte for byte
 *       before and after); the same zip opened again opens the same folder;
 *       and a hand-off unzipped by hand (Extract All) opens read only too.
 * No native window opens: every dialog and shell opener of the main process
 * is answered by the smoke before anything is clicked (guardNativeWindows),
 * and any call it did not expect fails a check at once.
 * Every page.evaluate returns plain data (BH13). With PDT_HANDOFF_SHOTS set
 * to a folder, the dialog and the read-only line are saved there, light and
 * dark. Zero page errors. Exits 0 when every check passed, 1 on a failed
 * check, 2 when it could not run.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SRC_SESSION = path.join(REPO, "sessions", "example-aggregate", "sess-2026-0514-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const SHOTS = process.env.PDT_HANDOFF_SHOTS || "";
const T = 20000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("handoff-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

/* The entries of a zip: { name: Buffer }, stored or deflated. */
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

/* The rows of every table in a .docx's document.xml, each "a | b | c". */
function docxRows(docxBuf) {
  const xml = zipFiles(docxBuf)["word/document.xml"].toString("utf8");
  const rows = [];
  for (const tr of xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
    const cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((tc) =>
      (tc.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
    rows.push(cells.join(" | "));
  }
  const text = (xml.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
  return { rows, text };
}

/* The sheet names of an .xlsx, and the text of its sheets. */
function xlsxInfo(buf) {
  const files = zipFiles(buf);
  const names = [...files["xl/workbook.xml"].toString("utf8").matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  const text = (i) => files["xl/worksheets/sheet" + i + ".xml"].toString("utf8");
  return { names, text };
}

/* Every file under `root`: { rel: "size mtime sha1" } (the "nothing written" check). */
function snapshot(root) {
  const out = {};
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { out[rel + e.name + "/"] = "dir"; walk(abs, rel + e.name + "/"); continue; }
      const st = fs.statSync(abs);
      out[rel + e.name] = st.size + " " + st.mtimeMs + " " + crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
    }
  })(root, "");
  return out;
}

/* The demo, copied to temp (its document titled "Order entry") and analyzed
   with the current pipeline. The project folder sits in a folder of its own,
   where the hand-off zips land beside it. */
function freshProject() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-handoff-e2e-"));
  const folder = path.join(base, "order-entry-project");
  fs.mkdirSync(folder);
  for (const f of ["events.jsonl", "manifest.json", "annotations.json"]) {
    const s = path.join(SRC_SESSION, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(folder, f));
  }
  const anno = readJson(path.join(folder, "annotations.json"));
  anno.document = Object.assign({}, anno.document || {}, { title: "Order entry" });
  fs.writeFileSync(path.join(folder, "annotations.json"), JSON.stringify(anno, null, 2));
  const bundled = path.join(VIEWER, "python", "python.exe");
  for (const py of fs.existsSync(bundled) ? [bundled] : ["python", "python3"]) {
    try {
      execFileSync(py, [path.join(REPO, "normalization", "normalize.py"), folder, "--mine"], { cwd: REPO, stdio: "ignore" });
      return { base, folder };
    } catch (_) { /* the next interpreter */ }
  }
  return null;
}

/* No native window may open on the machine running the smoke: its owner may
   be using it. Right after launch, before anything is clicked, every dialog
   and every shell opener of the main process is answered here at once
   (cancelled, nothing opened) and the call recorded. A check then puts its
   own answer on the one it expects (a save path, the zip to open); any other
   call fails the smoke at the next nativeCheck instead of waiting on a
   window. */
async function guardNativeWindows(app) {
  await app.evaluate(({ dialog, shell }) => {
    global.__unexpected = [];
    const note = (kind, args) => {
      const o = args.find((a) => a && typeof a === "object" && typeof a.isDestroyed !== "function") || {};
      global.__unexpected.push(kind + (o.title ? ": " + o.title : o.message ? ": " + o.message : ""));
      return o;
    };
    dialog.showOpenDialog = async (...a) => { note("open dialog", a); return { canceled: true, filePaths: [] }; };
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

async function waitFor(fn, ms, step) {
  const deadline = Date.now() + (ms || T);
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (_) { /* again */ }
    await wait(step || 200);
  }
  return last;
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) }).catch((e) => console.log("shot fail", name, e.message));
}
async function shotsBothThemes(page, stem, size) {
  if (!SHOTS) return;
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { require("./theme.js").setTheme(t); return true; }, theme);
    await wait(250);
    await shot(page, stem + "-" + size + "-" + theme + ".png");
  }
  await page.evaluate(() => { require("./theme.js").setTheme("light"); return true; });
}

/* The editing controls a hand-off opened read only must not show. */
const EDITING = [
  "#btn-session-pdd", "#btn-session-tech", "#btn-session-zip", "#btn-session-handoff",
  "#ov-next", "#btn-ov-next", "#btn-attach-video", "#btn-remove-video", "#btn-attach-transcript", "#btn-remove-transcript",
  ".summary-fix", "#btn-ov-attach", "[data-att-act=\"remove\"]", ".tr-add",
  "#btn-add-step", "#btn-sync-video", "#btn-video-remove", "#btn-link-recording", "#btn-tl-attach-video",
  ".tl-tr-sync", ".tl-tr-replace", ".tl-tr-remove", ".marker-actions", "[data-act=\"adjust\"]", "[data-act=\"delete\"]",
  "#tl-selection-case", "#tl-selection-exclude",
  "#btn-add-manual-step", "#btn-delete-selected-steps", "#btn-merge-selected", "#btn-group-selected",
  "#btn-ignored-apps", ".multi-check", "#btn-dissolve-level",
  "[data-act=\"confirm-run\"]", "[data-act=\"reopen-run\"]",
  "#btn-flow-only-when", "#btn-flow-go-to", "#btn-flow-remove-condition", ".flow-link-remove",
  "#btn-step-hide", "#btn-step-make-sub", "#btn-step-dissolve", "#btn-step-add-shot", "[data-shot-act]",
  "#btn-step-add-note", "[data-note-act]", "#btn-step-attach", "#btn-step-split", "#btn-step-merge",
  "#btn-step-merge-selected", "#btn-step-delete", ".si-split-btn",
  "#btn-fork-refmap", "#btn-toggle-refmaps", "#refmap-panel", "#btn-map-asis-edit", "#btn-map-asis-recopy",
  "#btn-apply-marker-edits", "#btn-help-reanalyze", "#btn-restore-annotations",
];
const visibleEditing = (page) => page.evaluate((sels) => sels.filter((s) =>
  Array.from(document.querySelectorAll(s)).some((el) => el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden")), EDITING);

(async () => {
  const made = freshProject();
  if (!made) { console.log("[handoff-e2e] FATAL: no Python with the pipeline dependencies"); process.exit(2); }
  const { base: BASE, folder: SESSION } = made;
  const ANNO = path.join(SESSION, "annotations.json");
  const ZIP1 = path.join(BASE, "Order entry v1.zip");
  const ZIP2 = path.join(BASE, "Order entry v2.zip");
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: [".", "--session=" + SESSION], cwd: VIEWER });
    // Before anything else: no native window (guardNativeWindows). The two
    // this viewer expects: Explorer at an export (recorded, not opened) and
    // the save dialog of an export (answered with the path set below).
    await guardNativeWindows(v.app);
    await v.app.evaluate(({ shell, dialog }) => {
      global.__shown = [];
      shell.showItemInFolder = (f) => { global.__shown.push(f); };
      global.__save = null;
      dialog.showSaveDialog = async (...a) => {
        const f = global.__save;
        global.__save = null;
        if (!f) { global.__unexpected.push("save dialog with no path set"); return { canceled: true, filePath: "" }; }
        return { canceled: false, filePath: f };
      };
      return true;
    });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: T });
  } catch (e) { console.error("[handoff-e2e] FATAL:", e); process.exit(2); }
  const size = (v.windowSize && v.windowSize.content) ? v.windowSize.content.width + "x" + v.windowSize.content.height : "size";
  const shown = () => v.app.evaluate(() => global.__shown.slice());
  const setSave = (f) => v.app.evaluate((_e, p) => { global.__save = p; return true; }, f);
  const idle = () => page.waitForFunction(() => !require("./views/flow-view.js").analysisBusy() &&
    !document.getElementById("run-status"), null, { timeout: 120000 });
  const exportItem = async (id) => {
    await page.click("#btn-session-export-menu");
    await page.waitForSelector("#" + id, { state: "visible", timeout: T });
    await page.click("#" + id);
  };
  await idle().catch(() => {});

  /* ---- (a) the first hand-off ---- */
  let entry1 = null;
  try {
    await exportItem("btn-session-handoff");
    const dlg = await page.waitForSelector(".modal-backdrop.modal-prompt", { timeout: T });
    const info = await page.evaluate(() => {
      const d = document.querySelector(".modal-backdrop.modal-prompt");
      return { title: d.querySelector("h2").textContent, msg: (d.querySelector(".modal-msg") || {}).textContent || "",
        detail: (d.querySelector(".modal-detail") || {}).textContent || "", value: d.querySelector(".modal-input").value,
        ok: d.querySelector(".modal-ok").textContent, okDisabled: d.querySelector(".modal-ok").disabled };
    });
    record("(a) Hand off... asks what changed in version 1, filled with First hand-off",
      info.title === "Hand off version 1" && info.msg === "What changed in this version?" &&
      info.value === "First hand-off" && info.ok === "Hand off" && !info.okDisabled &&
      info.detail.startsWith("Order entry v1.zip is made next to the project folder"), JSON.stringify(info));
    await shotsBothThemes(page, "handoff-dialog", size);
    await dlg.$eval(".modal-ok", (b) => { b.click(); return true; });
    const zipShown = await waitFor(async () => (await shown()).includes(ZIP1) && fs.existsSync(ZIP1), 180000, 300);
    record("(a) Order entry v1.zip is made next to the project folder and shown in its folder", !!zipShown,
      JSON.stringify(await shown()));
    const onDisk = readJson(ANNO);
    entry1 = (onDisk.handoffs || [])[0] || null;
    record("(a) annotations.json records version 1: the time, the Windows user, the note",
      (onDisk.handoffs || []).length === 1 && entry1.version === 1 && entry1.by === os.userInfo().username &&
      entry1.note === "First hand-off" && /^\d{4}-\d{2}-\d{2}T/.test(entry1.handed_off_at), JSON.stringify(onDisk.handoffs));
    const files = zipFiles(fs.readFileSync(ZIP1));
    const names = Object.keys(files);
    const root = path.basename(SESSION) + "/";
    record("(a) the zip holds the project folder and, at its root, the PDD and the Technical details of version 1",
      names.includes(root + "manifest.json") && names.includes(root + "events.jsonl") &&
      names.includes("Order entry v1 PDD.docx") && names.includes("Order entry v1 Technical details.xlsx") &&
      names.filter((n) => !n.includes("/")).length === 2, names.filter((n) => !n.startsWith(root)).join(", "));
    const inZip = JSON.parse(files[root + "annotations.json"].toString("utf8"));
    record("(a) the project inside the zip carries its version entry", (inZip.handoffs || []).length === 1 &&
      inZip.handoffs[0].handed_off_at === entry1.handed_off_at);
    const line1 = "Version 1, handed off " + entry1.handed_off_at.slice(0, 10) + " by " + entry1.by;
    const pdd = docxRows(files["Order entry v1 PDD.docx"]);
    record("(a) its PDD says which version it is, over a Version history table of one row",
      pdd.rows.includes("Version | " + line1) && pdd.text.includes("Version history") &&
      pdd.rows.includes("Version | Date | By | What changed") &&
      pdd.rows.includes("1 | " + entry1.handed_off_at.slice(0, 10) + " | " + entry1.by + " | First hand-off") &&
      pdd.rows.filter((r) => /^\d+ \| \d{4}-/.test(r)).length === 1, pdd.rows.filter((r) => r.startsWith("Version")).join(" / "));
    const x = xlsxInfo(files["Order entry v1 Technical details.xlsx"]);
    record("(a) its Technical details hold the five sheets, and the About sheet names the version",
      JSON.stringify(x.names) === JSON.stringify(["About", "Steps and controls", "Data fields", "Re-keyed values", "Applications"]) &&
      x.text(1).includes(line1) && x.text(2).includes("Step 1"), x.names.join(", "));
  } catch (e) { record("(a) the first hand-off", false, errText(e)); }
  await nativeCheck(v.app, "(a)");

  /* ---- (b) the second hand-off, and its Undo ---- */
  let entry2 = null;
  try {
    await idle();
    await exportItem("btn-session-handoff");
    const dlg = await page.waitForSelector(".modal-backdrop.modal-prompt", { timeout: T });
    const empty = await page.evaluate(() => {
      const d = document.querySelector(".modal-backdrop.modal-prompt");
      return { title: d.querySelector("h2").textContent, value: d.querySelector(".modal-input").value,
        okDisabled: d.querySelector(".modal-ok").disabled };
    });
    record("(b) version 2's dialog starts empty and OK waits for a note",
      empty.title === "Hand off version 2" && empty.value === "" && empty.okDisabled === true, JSON.stringify(empty));
    await page.fill(".modal-backdrop.modal-prompt .modal-input", "The credit check added");
    await dlg.$eval(".modal-ok", (b) => { b.click(); return true; });
    const done = await waitFor(async () => (await shown()).includes(ZIP2) && fs.existsSync(ZIP2), 180000, 300);
    record("(b) Order entry v2.zip is made beside the first, which stays", !!done && fs.existsSync(ZIP1));
    const onDisk = readJson(ANNO);
    entry2 = (onDisk.handoffs || [])[1] || null;
    record("(b) annotations.json records version 2 after version 1",
      (onDisk.handoffs || []).map((e) => e.version).join(",") === "1,2" && entry2.note === "The credit check added");
    const files = zipFiles(fs.readFileSync(ZIP2));
    const pdd = docxRows(files["Order entry v2 PDD.docx"]);
    const d1 = entry1.handed_off_at.slice(0, 10), d2 = entry2.handed_off_at.slice(0, 10);
    record("(b) its PDD reads version 2, with two rows in the Version history",
      pdd.rows.includes("Version | Version 2, handed off " + d2 + " by " + entry2.by) &&
      pdd.rows.includes("1 | " + d1 + " | " + entry1.by + " | First hand-off") &&
      pdd.rows.includes("2 | " + d2 + " | " + entry2.by + " | The credit check added") &&
      pdd.rows.filter((r) => /^\d+ \| \d{4}-/.test(r)).length === 2, pdd.rows.filter((r) => /^(Version|\d+ \|)/.test(r)).join(" / "));
    // Ctrl+Z takes version 2 back; the zip stays. Ctrl+Y brings it again.
    await page.click(".view-mode-btn[data-level=\"overview\"]");
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); return true; });
    await wait(600);
    await page.keyboard.press("Control+Z");
    const undone = await waitFor(() => { const a = readJson(ANNO); return (a.handoffs || []).length === 1 ? a : null; }, T);
    const toastText = await page.evaluate(() => document.getElementById("toast").textContent);
    record("(b) Ctrl+Z takes version 2 back, saying the zip file stays; the zip stays",
      !!undone && fs.existsSync(ZIP2) && /Hand off version 2 \(the zip file stays\)/.test(toastText), toastText);
    await page.keyboard.press("Control+Y");
    const redone = await waitFor(() => { const a = readJson(ANNO); return (a.handoffs || []).length === 2 ? a : null; }, T);
    record("(b) Ctrl+Y brings version 2 back", !!redone && redone.handoffs[1].handed_off_at === entry2.handed_off_at);
  } catch (e) { record("(b) the second hand-off", false, errText(e)); }
  await nativeCheck(v.app, "(b)");

  /* ---- (c) exports between hand-offs ---- */
  try {
    await idle();
    const between = path.join(BASE, "between.docx");
    await setSave(between);
    await exportItem("btn-session-pdd");
    await waitFor(() => fs.existsSync(between) && fs.statSync(between).size > 0, 120000, 300);
    const pdd = docxRows(fs.readFileSync(between));
    record("(c) a PDD exported between hand-offs reads Working copy after version 2, with the history",
      pdd.rows.includes("Version | Working copy after version 2") &&
      pdd.rows.filter((r) => /^\d+ \| \d{4}-/.test(r)).length === 2, pdd.rows.filter((r) => r.startsWith("Version")).join(" / "));
    await idle();
    const tech = path.join(BASE, "tech-alone.xlsx");
    await setSave(tech);
    await exportItem("btn-session-tech");
    await waitFor(() => fs.existsSync(tech) && fs.statSync(tech).size > 0, 120000, 300);
    const x = xlsxInfo(fs.readFileSync(tech));
    record("(c) Export, Technical details (.xlsx) writes the workbook on its own, a working copy",
      x.names.length === 5 && x.text(1).includes("Working copy after version 2") && (await shown()).includes(tech), x.names.join(", "));
  } catch (e) { record("(c) exports between hand-offs", false, errText(e)); }
  await nativeCheck(v.app, "(c)");
  record("no page error in the analyst's viewer", errs.length === 0, errs.slice(0, 3).join(" | "));
  await v.close();

  /* ---- (d) a developer opens the v2 zip, read only ---- */
  const errs2 = [];
  let w, dev;
  try {
    w = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    await guardNativeWindows(w.app);
    dev = await w.app.firstWindow();
    dev.on("console", (m) => { if (m.type() === "error") errs2.push(m.text()); });
    dev.on("pageerror", (e) => errs2.push(String(e && e.message ? e.message : e)));
    await dev.waitForSelector("#btn-open-handoff-hero", { state: "visible", timeout: T });
  } catch (e) { console.error("[handoff-e2e] FATAL (the developer's viewer):", e); process.exit(2); }
  try {
    const userData = await w.app.evaluate(({ app, dialog, shell }, zip) => {
      global.__dialogs = [];
      dialog.showOpenDialog = async (_win, opts) => {
        global.__dialogs.push({ title: opts.title, properties: opts.properties, filters: opts.filters });
        if (opts.title !== "Open a hand-off") { global.__unexpected.push("open dialog: " + opts.title); return { canceled: true, filePaths: [] }; }
        return { canceled: false, filePaths: [zip] };
      };
      global.__opened = [];
      shell.openPath = async (f) => { global.__opened.push(f); return ""; };
      return app.getPath("userData");
    }, ZIP2);
    const HANDOFFS = path.join(userData, "handoffs");
    if (SHOTS) {
      // The developer's first page, the Open menu dropped down.
      await dev.click("#btn-recent-menu");
      await shotsBothThemes(dev, "developer-open", size);
      await dev.click("#btn-recent-menu");
    }
    await dev.click("#btn-open-handoff-hero");
    await dev.waitForSelector("#session-loaded", { state: "visible", timeout: 60000 });
    await dev.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.readOnly); }, null, { timeout: T });
    const s = await dev.evaluate(() => { const x = require("./state.js").getSession(); return { folder: x.sessionFolder, readOnly: x.readOnly }; });
    const asked = await w.app.evaluate(() => global.__dialogs.slice());
    const fileDialog = asked.length === 1 && asked[0].title === "Open a hand-off" &&
      JSON.stringify(asked[0].properties) === JSON.stringify(["openFile"]) &&
      JSON.stringify(asked[0].filters) === JSON.stringify([{ name: "Hand-off zip", extensions: ["zip"] }]);
    record("(d) Open a hand-off (.zip) asks for a zip file, extracts it under the viewer's own folder and opens it read only",
      fileDialog && s.readOnly === true && s.folder.startsWith(path.join(HANDOFFS, "Order entry v2") + path.sep) &&
      fs.existsSync(path.join(s.folder, "manifest.json")), s.folder + " " + JSON.stringify(asked));
    await wait(800);
    const before = snapshot(path.dirname(s.folder));
    const d2 = entry2 ? entry2.handed_off_at.slice(0, 10) : "?";
    const expectLine = "Version 2, handed off " + d2 + " by " + (entry2 ? entry2.by : "?") + " · Read only";
    const top = await dev.evaluate(() => ({
      line: (document.getElementById("ov-handoff") || {}).textContent || "",
      title: (document.getElementById("ov-handoff") || { title: "" }).title,
      save: document.getElementById("save-state").textContent,
      saveTitle: document.getElementById("save-state").title,
      shell: document.querySelector(".app").classList.contains("read-only"),
      docLocked: Array.from(document.querySelectorAll("#ov-doc [data-doc]")).every((el) => el.readOnly),
      docCount: document.querySelectorAll("#ov-doc [data-doc]").length,
      who: (document.getElementById("ov-doc-who") || {}).textContent || "",
    }));
    record("(d) the project line reads the version, the date and who handed it off, then Read only",
      top.line === expectLine && top.title === "What changed in this version: The credit check added", JSON.stringify(top.line));
    record("(d) the top bar's save state reads Read only, with the version in its tooltip",
      top.save === "Read only" && top.saveTitle.startsWith(expectLine.replace(" · Read only", "")), top.saveTitle);
    record("(d) the document's fields are read, not typed in", top.shell && top.docLocked && top.docCount === 10 &&
      top.who === "The analyst wrote these. The PDD prints them.", JSON.stringify(top));
    await shotsBothThemes(dev, "readonly-line", size);
    const bad = {};
    bad.overview = await visibleEditing(dev);
    // The Timeline: its right-click offers only the way to the step.
    await dev.click(".view-mode-btn[data-level=\"flow\"]");
    await wait(600);
    bad.flow = await visibleEditing(dev);
    const tlItems = await dev.evaluate(() => {
      const tl = document.getElementById("timeline");
      const r = tl.getBoundingClientRect();
      tl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.5, clientY: r.top + 6 }));
      const m = document.getElementById("tl-ctx-menu");
      return m ? Array.from(m.children).map((c) => c.textContent) : null;
    });
    await dev.keyboard.press("Escape");
    record("(d) the Timeline's right-click offers only Jump to step here",
      JSON.stringify(tlItems) === JSON.stringify(["Jump to step here"]), JSON.stringify(tlItems));
    // Steps: a step selected; its pane read only; no verb from the keyboard,
    // a double-click or a right-click.
    await dev.click(".view-mode-btn[data-level=\"steps\"]");
    await dev.waitForSelector("#step-list .step-row", { timeout: T });
    await dev.click("#step-list .step-row .step-name");
    await dev.waitForSelector("#step-name", { timeout: T });
    await wait(300);
    const pane = await dev.evaluate(() => ({
      name: document.getElementById("step-name").readOnly, desc: document.getElementById("step-desc").readOnly,
      system: (document.getElementById("step-system") || { readOnly: true }).readOnly,
      waste: document.getElementById("flag-waste").disabled,
    }));
    record("(d) the step pane's fields are read only", pane.name && pane.desc && pane.system && pane.waste, JSON.stringify(pane));
    bad.steps = await visibleEditing(dev);
    await shotsBothThemes(dev, "readonly-steps", size);
    await dev.evaluate(() => { document.getElementById("step-list").focus(); if (document.activeElement) document.activeElement.blur(); return true; });
    for (const key of ["Enter", "n", "s", "m", "Control+Enter", "Alt+ArrowDown", "Control+Z", "Control+Y"]) {
      await dev.keyboard.press(key);
      await wait(150);
    }
    const afterKeys = await dev.evaluate(() => ({
      dialogs: Array.from(document.querySelectorAll(".modal-backdrop")).filter((m) => getComputedStyle(m).display !== "none").length,
      renaming: !!document.querySelector(".step-name-edit"),
    }));
    await dev.dblclick("#step-list .step-row .step-name");
    await wait(300);
    const renaming = await dev.evaluate(() => !!document.querySelector(".step-name-edit"));
    record("(d) no shortcut and no double-click opens an edit (no dialog, no rename field)",
      afterKeys.dialogs === 0 && !afterKeys.renaming && !renaming, JSON.stringify(afterKeys) + " dblclick " + renaming);
    await dev.click("#step-list .step-row .step-name", { button: "right" });
    const stepItems = await dev.evaluate(() => {
      const m = document.getElementById("step-ctx-menu");
      return m ? Array.from(m.children).map((c) => c.textContent).filter(Boolean) : null;
    });
    await dev.keyboard.press("Escape");
    record("(d) a step's right-click offers only the ways to look at it",
      !!stepItems && stepItems.length > 0 && stepItems.every((t) => ["Open sub-process", "Show on timeline", "Watch"].includes(t)),
      JSON.stringify(stepItems));
    // The Map: the map the hand-off came with, drawn without an analysis.
    await dev.click(".view-mode-btn[data-level=\"map\"]");
    const readMap = () => dev.evaluate(() => ({
      busy: require("./refmap-ui.js").mapBusy() || require("./views/flow-view.js").analysisBusy(),
      run: require("./state.js").getAnalysisRun(),
      drawn: !!document.querySelector("#map-asis-canvas .djs-container > svg"),
    }));
    const map = (await waitFor(() => readMap().then((m) => (m.drawn ? m : null)), T)) || await readMap();
    bad.map = await visibleEditing(dev);
    record("(d) the Map shows its map with no analysis", !map.busy && map.run === null && map.drawn, JSON.stringify(map));
    const shownEditing = Object.entries(bad).filter(([, list]) => list.length);
    record("(d) no editing control shows on any level", shownEditing.length === 0, JSON.stringify(shownEditing));
    // Export: the map exports, and the two files the hand-off came with.
    await dev.click("#btn-session-export-menu");
    const items = await dev.evaluate(() => Array.from(document.querySelectorAll("#session-export-popup .project-menu-item"))
      .filter((b) => b.getClientRects().length > 0).map((b) => b.textContent));
    record("(d) Export offers the PDD and the Technical details of this version, and the map exports",
      JSON.stringify(items) === JSON.stringify(["PDD of this version", "Technical details of this version",
        "Process map (image)", "Process map (BPMN)"]), JSON.stringify(items));
    await dev.click("#btn-handoff-open-pdd");
    const opened = await waitFor(() => w.app.evaluate(() => global.__opened.slice()).then((l) => (l.length ? l : null)), T);
    record("(d) PDD of this version opens the PDD the zip came with",
      !!opened && opened[0] === path.join(path.dirname(s.folder), "Order entry v2 PDD.docx"), JSON.stringify(opened));
    // Help: no Re-analyze.
    await dev.click("#btn-help");
    await dev.click(".help-nav-item[data-section=\"trouble\"]");
    const reanalyze = await dev.evaluate(() => { const b = document.getElementById("btn-help-reanalyze"); return !!b && b.getClientRects().length > 0; });
    await dev.keyboard.press("Escape");
    record("(d) Help offers no Re-analyze", reanalyze === false);
    await wait(500);
    const after = snapshot(path.dirname(s.folder));
    const changed = Object.keys(Object.assign({}, before, after)).filter((k) => before[k] !== after[k]);
    record("(d) nothing was written to disk: the hand-off's folder byte for byte as it opened", changed.length === 0,
      changed.slice(0, 6).join(", "));
    // The same zip again, from the Open menu: the same folder.
    await dev.click("#btn-recent-menu");
    await dev.click("#btn-open-handoff");
    await wait(1500);
    const again = await dev.evaluate(() => require("./state.js").getSession().sessionFolder);
    record("(d) the same zip opened again opens the same folder", again === s.folder &&
      fs.readdirSync(HANDOFFS).filter((n) => !n.startsWith(".")).length === 1, fs.readdirSync(HANDOFFS).join(", "));
  } catch (e) { record("(d) the read-only open", false, errText(e)); }
  await nativeCheck(w.app, "(d)");
  // A hand-off unzipped by hand (Extract All, then Open project on the folder
  // it makes) opens read only too: its PDD and Technical details lie beside
  // the project.
  try {
    const manual = path.join(BASE, "Order entry v2 unzipped");
    for (const [name, data] of Object.entries(zipFiles(fs.readFileSync(ZIP2)))) {
      const target = path.join(manual, ...name.split("/").filter(Boolean));
      if (name.endsWith("/")) fs.mkdirSync(target, { recursive: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); }
    }
    await w.app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async (_win, opts) => {
        if (opts.title !== "Open project") { global.__unexpected.push("open dialog: " + opts.title); return { canceled: true, filePaths: [] }; }
        return { canceled: false, filePaths: [f] };
      };
      return true;
    }, manual);
    await dev.click("#btn-recent-menu");
    await dev.click("#btn-open-session");
    const project = path.join(manual, path.basename(SESSION));
    await waitFor(() => dev.evaluate((f) => { const x = require("./state.js").getSession(); return !!(x && x.sessionFolder === f); }, project), T);
    await wait(800);
    const before = snapshot(manual);
    const st = await dev.evaluate(() => ({ ro: require("./state.js").getSession().readOnly === true,
      line: (document.getElementById("ov-handoff") || {}).textContent || "", save: document.getElementById("save-state").textContent }));
    await dev.evaluate(() => { if (document.activeElement) document.activeElement.blur(); return true; });
    await dev.keyboard.press("Control+Z");
    await wait(500);
    const after = snapshot(manual);
    record("(d) a hand-off unzipped by hand (Extract All) opens read only too, and nothing is written",
      st.ro && st.save === "Read only" && st.line.endsWith(" · Read only") && JSON.stringify(before) === JSON.stringify(after),
      JSON.stringify(st));
  } catch (e) { record("(d) a hand-off unzipped by hand", false, errText(e)); }
  await nativeCheck(w.app, "(d) unzipped by hand");
  record("no page error in the developer's viewer", errs2.length === 0, errs2.slice(0, 3).join(" | "));
  await w.close();

  fs.rmSync(BASE, { recursive: true, force: true });
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n[handoff-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[handoff-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[handoff-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
