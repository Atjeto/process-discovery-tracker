"use strict";
/*
 * Activity library e2e smoke (contract C21, lane LIB-V). Launches the REAL
 * viewer on a throwaway profile with a test library (PDT_LIBRARY names a
 * file in a temp folder), every main-process dialog replaced before anything
 * can open one. Everything is made in a temp folder.
 *   (a) A new empty project, a step added by hand: while its name has the
 *       focus, one quiet line says to set the system first, and no list
 *       opens. Its system set to Phone: a click in the name opens the list of
 *       Phone's activities (the name, the code, the description); a pick sets
 *       the name, the system, library_activity and the activity's
 *       description (the step had none), and the fact line shows the code
 *       next to the system. Ctrl+Z takes the pick back.
 *   (b) Typing any name stays possible: a name typed leaves the library (no
 *       library_activity, no code); a name typed that is an activity's names
 *       the step from the library; a filtered list and the keys (Down,
 *       Enter) pick an activity without a description, which leaves the
 *       step's description as it is.
 *   (c) A system without activities: the quiet line says so, no list.
 *   (d) The project's library.json after its first analysis: the app's
 *       library copied (needs the pipeline's --library, lane LIB-P; when the
 *       pipeline in this tree has no --library this is said in one line and
 *       not checked).
 *   (e) The Remembered step names button and dialog are gone, and no
 *       remembered-names store is written in the profile.
 *   (f) Help: the library's line under the version ("Library 1: 4
 *       applications, 4 activities"), one paragraph on the library, and
 *       Build the library...
 *   (g) The builder fed two temp projects (a folder with Add projects..., a
 *       zip with Add hand-off zips..., read where it is): the named steps by
 *       system, the same screens named differently side by side as one
 *       conflict; a conflict ticked is refused with the reason; the save
 *       dialog offers the app's library file; the saved file is a valid
 *       library (format 1, a new version, the new activity with its code and
 *       screens, the library's activities kept).
 *   Zero page errors. With PDT_LIBRARY_SHOTS=<folder> it saves the picker,
 *   the builder with its conflict and Help's library line, light and dark,
 *   named after the window size. Exits 0 when every check passed, 1 on a
 *   failed check, 2 when it could not run.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright-core");
const { launchViewer, logActionError } = require("./throwaway-profile.js");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const Library = require(path.join(VIEWER, "library.js"));
const { zipFolder } = require(path.join(VIEWER, "zip-folder.js"));
const T = 20000;
const SHOTS = process.env.PDT_LIBRARY_SHOTS ? path.resolve(process.env.PDT_LIBRARY_SHOTS) : null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  | " + detail : ""));
}
const errText = (e) => { logActionError("library-smoke", e); return String((e && e.message) || e).split("\n")[0]; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

const K_ORDER = "chrome|Salesforce - Order|Button:save-order";
const K_EXCEL = "excel|Excel - Order Tracking.xlsx|Button:save-workbook";
const K_SEARCH = "chrome|Salesforce - Account lookup|Button:search";

/* The test library: version 1, four applications, four activities. */
const TEST_LIBRARY = {
  format: 1, version: "1",
  applications: [
    { name: "Salesforce", activities: [
      { id: "sf-save-order", name: "Save the order", code: "SO-01", description: "Saves the sales order.", screens: [[K_ORDER]] },
      { id: "sf-find-customer", name: "Find the customer", code: "SO-02", screens: [[K_SEARCH]] },
    ] },
    { name: "SAP", activities: [] },
    { name: "Excel", activities: [] },
    { name: "Phone", activities: [
      { id: "phone-call", name: "Call the customer", code: "PH-01", description: "Calls the customer to confirm the order.", screens: [] },
      { id: "phone-voicemail", name: "Leave a voicemail", screens: [] },
    ] },
  ],
};

/* A project folder of invented data for the builder: its manifest and
   annotations only. */
function makeProject(dir, label, sessionId, steps) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ session_id: sessionId, source: "blank", started_at: "2026-09-25T09:00:00Z", label }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), "");
  fs.writeFileSync(path.join(dir, "annotations.json"), JSON.stringify({ version: 1, steps }));
  return dir;
}
const st = (id, state, name, more) => Object.assign({ step_id: id, state, name, case_id: "c1", time_range: null }, more || {});

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-library-"));
  const LIB = path.join(TMP, "app", "library", "activities.json");
  fs.mkdirSync(path.dirname(LIB), { recursive: true });
  fs.writeFileSync(LIB, JSON.stringify(TEST_LIBRARY, null, 2));
  process.env.PDT_LIBRARY = LIB;   // the viewer's app library, for this run only
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const errs = [];
  let v, page;
  try {
    v = await launchViewer(electron, { executablePath: electronPath, args: ["."], cwd: VIEWER });
    page = await v.app.firstWindow();
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e && e.message ? e.message : e)));
    await page.waitForSelector("#btn-recent-menu", { timeout: T });
  } catch (e) { console.error("[library-e2e] FATAL:", e); process.exit(2); }
  const app = v.app;
  const size = v.windowSize ? v.windowSize.content.width + "x" + v.windowSize.content.height : "window";

  // No native dialog may open: every one answers here, and Explorer is not
  // opened. The dialogs a check uses are set again right before it.
  await app.evaluate(({ dialog, shell }) => {
    global.__dialogs = [];
    dialog.showOpenDialog = async (_w, o) => { global.__dialogs.push({ kind: "open", title: (o || _w || {}).title || "" }); return { canceled: true, filePaths: [] }; };
    dialog.showSaveDialog = async (_w, o) => { global.__dialogs.push({ kind: "save", title: (o || _w || {}).title || "" }); return { canceled: true }; };
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showErrorBox = () => {};
    shell.showItemInFolder = () => {};
    shell.openPath = async () => "";
  });
  const stubSave = (p) => app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async (_w, o) => { global.__saveAsked = (o || _w || {}); return { canceled: false, filePath: f }; };
  }, p);
  const stubOpen = (paths) => app.evaluate(({ dialog }, fs_) => {
    dialog.showOpenDialog = async (_w, o) => { global.__openAsked = (o || _w || {}).title || ""; return { canceled: false, filePaths: fs_ }; };
  }, paths);
  // A theme change draws the level again (an open list closes): `prepare`
  // puts the state to show back after it.
  const shot = async (name, prepare) => {
    if (!SHOTS) return;
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => require("./theme.js").setTheme(t), theme);
      await wait(250);
      if (prepare) await prepare();
      await page.screenshot({ path: path.join(SHOTS, name + "-" + theme + "-" + size + ".png") });
    }
    await page.evaluate(() => require("./theme.js").setTheme("light"));
    await wait(250);
    if (prepare) await prepare();
  };
  const openList = async () => {
    if (!(await page.evaluate(() => { const l = document.getElementById("step-activity-list"); return !!l && !l.hidden; }))) {
      await page.locator("#step-name").click({ timeout: T });
    }
    await page.waitForSelector("#step-activity-list:not([hidden]) .step-activity", { timeout: T });
  };

  const session = () => page.evaluate(() => {
    const s = require("./state.js").getSession();
    return s ? { folder: s.sessionFolder, steps: (s.annotations && s.annotations.steps) || [],
      library: s.library ? { source: s.library.source, status: s.library.status, version: s.library.library.version } : null } : null;
  });
  const stepById = async (id) => ((await session()).steps.find((x) => x.step_id === id)) || null;
  const settled = async () => {
    await page.waitForFunction(() => { const s = require("./state.js").getSession(); return !!(s && s.stats && s.analysis) && !document.getElementById("run-status"); },
      null, { timeout: 120000 });
    await wait(300);
  };
  const level = async (l) => { await page.locator('.view-mode-btn[data-level="' + l + '"]').click({ timeout: T }); await wait(300); };
  const prompt = async (text) => {
    await page.waitForSelector(".modal-prompt .modal-input", { timeout: T });
    await page.fill(".modal-prompt .modal-input", text);
    await page.click(".modal-prompt .modal-ok");
    await page.waitForSelector(".modal-prompt", { state: "detached", timeout: T });
  };
  const addStep = async (name) => {
    await page.click("#btn-add-manual-step");
    await prompt(name);
    await page.waitForFunction((n) => [...document.querySelectorAll("#step-list .step-row .step-name")].some((x) => x.textContent === n), name, { timeout: T });
    return (await session()).steps.find((x) => x.name === name).step_id;
  };
  const selectStep = async (id) => {
    await page.locator('#step-list .step-row[data-step-id="' + id + '"] .step-name').click({ timeout: T });
    await page.waitForFunction((sid) => require("./state.js").getSelectedStepId() === sid && !!document.getElementById("step-name"), id, { timeout: T });
    await wait(150);
  };
  const setSystem = async (id, sys) => {
    await page.fill("#step-system", sys);
    await page.press("#step-system", "Enter");
    await page.waitForFunction(([sid, v]) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).system === v,
      [id, sys], { timeout: T });
    await wait(200);
  };
  // What the name field shows: the quiet line (shown or not), the list and its rows.
  const pickerState = () => page.evaluate(() => {
    const note = document.getElementById("step-lib-note");
    const list = document.getElementById("step-activity-list");
    const rows = list && !list.hidden ? [...list.querySelectorAll(".step-activity")].map((li) => ({
      name: ((li.querySelector(".step-activity-name") || {}).textContent || "").trim(),
      code: ((li.querySelector(".step-activity-code") || {}).textContent || "").trim(),
      desc: ((li.querySelector(".step-activity-desc") || {}).textContent || "").trim(),
      current: li.classList.contains("current"), active: li.classList.contains("active"),
    })) : [];
    return {
      note: note ? note.textContent.trim() : null,
      noteShown: !!note && getComputedStyle(note).visibility === "visible",
      list: !!list, open: !!list && !list.hidden, rows,
      fact: ((document.querySelector("#step-detail .step-fact") || {}).textContent || "").trim(),
      name: (document.getElementById("step-name") || {}).value || "",
      focused: document.activeElement && document.activeElement.id,
    };
  });

  // ================= (a) the picker on a step added by hand =================
  const BLANK = path.join(TMP, "Order intake");
  let a = {};
  let callId = null;
  try {
    await stubSave(BLANK);
    await page.click("#btn-new-menu");
    await page.click("#btn-new-blank");
    await page.waitForFunction((f) => { const s = require("./state.js").getSession(); return !!s && String(s.sessionFolder).toLowerCase() === f.toLowerCase(); },
      path.resolve(BLANK), { timeout: 60000 });
    await settled();
    await level("steps");
    callId = await addStep("Call");
    await selectStep(callId);
    await page.locator("#step-name").focus();
    a.noSystem = await pickerState();
    await setSystem(callId, "Phone");
    await page.locator("#step-name").click({ timeout: T });
    await page.waitForSelector("#step-activity-list:not([hidden]) .step-activity", { timeout: T });
    a.open = await pickerState();
    await shot("picker", openList);
    await page.locator("#step-activity-list .step-activity", { hasText: "Call the customer" }).click({ timeout: T });
    await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).library_activity === "phone-call",
      callId, { timeout: T });
    await wait(300);
    a.picked = await stepById(callId);
    a.after = await pickerState();
    a.disk = readJson(path.join(BLANK, "annotations.json")).steps.find((x) => x.step_id === callId);
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await page.keyboard.press("Control+z");
    await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).name === "Call",
      callId, { timeout: T });
    a.undone = await stepById(callId);
    await page.keyboard.press("Control+y");
    await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).library_activity === "phone-call",
      callId, { timeout: T });
    a.redone = await stepById(callId);
  } catch (e) { a.err = errText(e); }
  record("(a) a step added by hand: with no system the name field says in one quiet line to set it first (no list); with Phone set, a click opens Phone's activities (name, code, description)",
    !a.err && a.noSystem.note === "Set the system first: the library lists activities by system." && a.noSystem.noteShown && !a.noSystem.list &&
      a.open.open && JSON.stringify(a.open.rows.map((r) => [r.name, r.code, r.desc])) ===
        JSON.stringify([["Call the customer", "PH-01", "Calls the customer to confirm the order."], ["Leave a voicemail", "", ""]]) &&
      a.open.note === null,
    JSON.stringify({ err: a.err, noSystem: a.noSystem, open: a.open && a.open.rows }));
  record("(a) the pick sets the name, the system, library_activity and the activity's description (the step had none), on disk; the fact line shows the code next to the system; Ctrl+Z takes it back, Ctrl+Y makes it again",
    !a.err && a.picked && a.picked.name === "Call the customer" && a.picked.system === "Phone" && a.picked.library_activity === "phone-call" &&
      a.picked.description === "Calls the customer to confirm the order." && a.picked.state === "manually_authored" &&
      a.disk && a.disk.library_activity === "phone-call" && a.disk.name === "Call the customer" &&
      /^Phone · PH-01( ·|$)/.test(a.after.fact) && a.after.name === "Call the customer" && !a.after.open &&
      a.undone && a.undone.name === "Call" && !a.undone.library_activity && !a.undone.description &&
      a.redone && a.redone.name === "Call the customer" && a.redone.library_activity === "phone-call",
    JSON.stringify({ picked: a.picked && [a.picked.name, a.picked.system, a.picked.library_activity, a.picked.description, a.picked.state],
      fact: a.after && a.after.fact, undone: a.undone && [a.undone.name, a.undone.library_activity || null], redone: a.redone && a.redone.name }));

  // ================= (b) typing stays possible; the keys =================
  let b = {};
  try {
    await selectStep(callId);
    await page.fill("#step-name", "Call back later");
    await page.press("#step-name", "Enter");
    await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).name === "Call back later",
      callId, { timeout: T });
    await wait(200);
    b.typed = await stepById(callId);
    b.typedFact = (await pickerState()).fact;
    await page.fill("#step-name", "leave a VOICEMAIL");
    await page.press("#step-name", "Enter");
    await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).library_activity === "phone-voicemail",
      callId, { timeout: T });
    b.typedActivity = await stepById(callId);
    // A second step in Salesforce, picked with the keys from a filtered list.
    const findId = await addStep("Look it up");
    await selectStep(findId);
    await setSystem(findId, "Salesforce");
    await page.locator("#step-name").click({ timeout: T });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("so-02");
    await page.waitForSelector("#step-activity-list:not([hidden]) .step-activity", { timeout: T });
    b.filtered = (await pickerState()).rows.map((r) => r.name);
    await page.keyboard.press("ArrowDown");
    b.lit = (await pickerState()).rows.filter((r) => r.active).map((r) => r.name);
    await page.keyboard.press("Enter");
    await page.waitForFunction((sid) => ((require("./state.js").getSession().annotations.steps || []).find((x) => x.step_id === sid) || {}).library_activity === "sf-find-customer",
      findId, { timeout: T });
    await wait(200);
    b.keyed = await stepById(findId);
    b.keyedState = await pickerState();
  } catch (e) { b.err = errText(e); }
  record("(b) typing any name stays possible (the step leaves the library: no library_activity, no code); a typed name that is an activity's names the step from the library; a filtered list, Down and Enter pick an activity, whose missing description leaves the step's as it is",
    !b.err && b.typed && b.typed.name === "Call back later" && !b.typed.library_activity && !/PH-01/.test(b.typedFact) &&
      b.typedActivity && b.typedActivity.name === "Leave a voicemail" && b.typedActivity.library_activity === "phone-voicemail" &&
      JSON.stringify(b.filtered) === '["Find the customer"]' && JSON.stringify(b.lit) === '["Find the customer"]' &&
      b.keyed && b.keyed.name === "Find the customer" && b.keyed.system === "Salesforce" && !b.keyed.description &&
      /^Salesforce · SO-02/.test(b.keyedState.fact) && !b.keyedState.open,
    JSON.stringify({ err: b.err, typed: b.typed && [b.typed.name, b.typed.library_activity || null], typedFact: b.typedFact,
      typedActivity: b.typedActivity && [b.typedActivity.name, b.typedActivity.library_activity], filtered: b.filtered, lit: b.lit,
      keyed: b.keyed && [b.keyed.name, b.keyed.system, b.keyed.description || ""], fact: b.keyedState && b.keyedState.fact }));

  // ================= (c) a system without activities =================
  let c = {};
  try {
    const sapId = await addStep("Enter the order");
    await selectStep(sapId);
    await setSystem(sapId, "SAP");
    await page.locator("#step-name").click({ timeout: T });
    await wait(200);
    c.focused = await pickerState();
    await shot("picker-no-activities", async () => { await page.locator("#step-name").click({ timeout: T }); await wait(150); });
    await page.locator("#step-desc").click({ timeout: T });
    await wait(150);
    c.blurred = await pickerState();
  } catch (e) { c.err = errText(e); }
  record("(c) a system with no activities in the library: while the name has the focus one quiet line says so, and no list opens; the line goes with the focus",
    !c.err && c.focused.note === "The library has no activities for SAP." && c.focused.noteShown && !c.focused.list &&
      c.blurred.noteShown === false,
    JSON.stringify(c));

  // ================= (d) the project's library.json =================
  const pipelineTakesLibrary = fs.readFileSync(path.join(REPO, "normalization", "normalize.py"), "utf8").includes('"--library"');
  if (pipelineTakesLibrary) {
    let d = {};
    try {
      const own = path.join(BLANK, "library.json");
      d.exists = fs.existsSync(own);
      d.same = d.exists && JSON.stringify(readJson(own)) === JSON.stringify(TEST_LIBRARY);
      d.session = (await session()).library;
    } catch (e) { d.err = errText(e); }
    record("(d) after its first analysis the project holds the app's library as library.json, and the viewer reads the project's copy",
      !d.err && d.exists && d.same && d.session && d.session.source === "project" && d.session.version === "1", JSON.stringify(d));
  } else {
    console.log("[SKIP] (d) the project's library.json: the pipeline in this tree has no --library (lane LIB-P not merged), so the viewer passed none and the project reads the app's library");
  }

  // ================= (e) no remembered step names =================
  let e5 = {};
  try {
    e5.dom = await page.evaluate(() => document.querySelectorAll("#btn-remembered-names, #remembered-names-dialog").length +
      [...document.querySelectorAll("button")].filter((b) => /Remembered step names/.test(b.textContent || "")).length);
    e5.store = fs.existsSync(path.join(v.profileDir, "pdt-library", "remembered-names.json"));
  } catch (e) { e5.err = errText(e); }
  record("(e) the Remembered step names button and dialog are gone, and the renames wrote no remembered-names store in the profile",
    !e5.err && e5.dom === 0 && e5.store === false, JSON.stringify(e5));

  // ================= (f) Help =================
  let f = {};
  try {
    await page.click("#btn-help");
    await page.locator('.help-nav-item[data-section="stepsphases"]').click({ timeout: T });
    await page.waitForFunction(() => /^Library /.test(((document.getElementById("help-library") || {}).textContent || "").trim()), null, { timeout: T });
    f = await page.evaluate(() => {
      const sec = document.querySelector('.help-section[data-section="stepsphases"]');
      const heads = [...sec.querySelectorAll("h3")].map((h) => h.textContent.trim());
      const i = heads.indexOf("The activity library");
      const lib = document.getElementById("help-library");
      const ver = document.getElementById("help-version");
      const b = document.getElementById("btn-build-library");
      return {
        line: lib.textContent.trim(), title: lib.title,
        below: ver.getBoundingClientRect().bottom <= lib.getBoundingClientRect().top + 1,
        heads, para: i >= 0 ? sec.querySelectorAll("h3")[i].nextElementSibling.textContent.replace(/\s+/g, " ").trim() : "",
        build: b ? { text: b.textContent.trim(), shown: b.getClientRects().length > 0 } : null,
        remembered: /Remembered step names/.test(sec.textContent),
      };
    });
    await shot("help-library", () => page.evaluate(() => document.getElementById("btn-build-library").scrollIntoView({ block: "center" })));
  } catch (e) { f.err = errText(e); }
  record("(f) Help: the app's library under the version (Library 1: 4 applications, 4 activities, the file in its tooltip), one paragraph on the library (what it is, a project keeps the library it started with, where the file is), Build the library..., no Remembered step names",
    !f.err && f.line === "Library 1: 4 applications, 4 activities" && f.title === LIB && f.below &&
      /offers the activities of the step's system/.test(f.para) && /A project keeps the library it started with/.test(f.para) &&
      /library\\activities\.json/.test(f.para) && f.build && f.build.text === "Build the library..." && f.build.shown && !f.remembered,
    JSON.stringify(f));

  // ================= (g) the builder =================
  const P1 = makeProject(path.join(TMP, "projects", "Order intake A"), "Order intake A", "lib-s1", [
    st("a1", "confirmed", "Save the order", { draft_key: K_ORDER }),
    st("a2", "edited", "Update the tracker", { draft_key: K_EXCEL }),
    st("a3", "auto_suggested", "Salesforce - Account lookup: Search", { draft_key: K_SEARCH }),
  ]);
  const P2 = makeProject(path.join(TMP, "projects", "Order call B"), "Order call B", "lib-s2", [
    st("b1", "edited", "Book the order", { draft_key: K_ORDER }),
    st("b2", "manually_authored", "Call the customer", { system: "Phone" }),
    st("b3", "manually_authored", "Write it down"),
  ]);
  const Z2 = path.join(TMP, "zips", "Order call B v1.zip");
  fs.mkdirSync(path.dirname(Z2), { recursive: true });
  await zipFolder(P2, Z2);
  const OUT = path.join(TMP, "saved", "activities.json");
  let g = {};
  try {
    await page.click("#btn-build-library");
    await page.waitForSelector("#library-builder .lb-intro", { timeout: T });
    g.helpClosed = await page.evaluate(() => getComputedStyle(document.getElementById("help-modal")).display === "none");
    await stubOpen([P1]);
    await page.click("#btn-lb-add-projects");
    await page.waitForFunction(() => /Read 1 project/.test((document.getElementById("lb-read") || {}).textContent || ""), null, { timeout: T });
    await stubOpen([Z2]);
    await page.click("#btn-lb-add-zips");
    await page.waitForFunction(() => /Read 2 projects/.test((document.getElementById("lb-read") || {}).textContent || ""), null, { timeout: T });
    g.read = await page.evaluate(() => document.getElementById("lb-read").textContent.trim());
    g.zipLeft = fs.readdirSync(path.dirname(Z2));
    g.view = await page.evaluate(() => [...document.querySelectorAll("#library-builder .lb-app")].map((sec) => ({
      app: sec.querySelector("h3").textContent.trim(),
      clusters: [...sec.querySelectorAll(".lb-cluster")].map((cl) => ({
        conflict: cl.classList.contains("conflict"),
        note: ((cl.querySelector(".lb-conflict-note") || {}).textContent || "").trim(),
        rows: [...cl.querySelectorAll(".lb-row")].map((r) => ({
          name: r.querySelector(".lb-name").value, ticked: r.querySelector(".lb-tick").checked,
          meta: r.querySelector(".lb-meta").textContent.trim(),
        })),
      })),
    })));
    await page.evaluate(() => { const c = document.querySelector("#library-builder .lb-cluster.conflict"); if (c) c.scrollIntoView({ block: "center" }); });
    await shot("builder-conflict");
    // Tick the conflicting name: the save is refused, with the reason.
    const row = (name) => page.locator("#library-builder .lb-row").filter({ has: page.locator('.lb-name[value="' + name + '"]') });
    await row("Book the order").locator(".lb-tick").check({ timeout: T });
    await stubSave(OUT);
    await page.click("#btn-lb-save");
    await page.waitForFunction(() => /^The library cannot be saved: /.test((document.getElementById("lb-error") || {}).textContent || ""), null, { timeout: T });
    g.refused = await page.evaluate(() => document.getElementById("lb-error").textContent.trim());
    g.savedAfterRefusal = fs.existsSync(OUT);
    await row("Book the order").locator(".lb-tick").uncheck({ timeout: T });
    // Tick Update the tracker with a code, and save.
    await row("Update the tracker").locator(".lb-tick").check({ timeout: T });
    await row("Update the tracker").locator(".lb-code").fill("EX-01", { timeout: T });
    await page.click("#btn-lb-save");
    await page.waitForSelector("#library-builder", { state: "detached", timeout: T });
    g.asked = await app.evaluate(() => ({ defaultPath: (global.__saveAsked || {}).defaultPath || "", title: (global.__saveAsked || {}).title || "" }));
    g.saved = fs.existsSync(OUT) ? readJson(OUT) : null;
    g.toast = await page.evaluate(() => (document.getElementById("toast").textContent || "").trim());
  } catch (e) { g.err = errText(e); }
  const sf = (g.view || []).find((x) => x.app === "Salesforce");
  const conflict = sf && sf.clusters.find((cl) => cl.conflict);
  record("(g) the builder reads a project folder and a hand-off zip (not unzipped): the named steps by system, the drafts nobody named and the step without a system left out; the same screens named differently side by side as one conflict, the library's activity ticked",
    !g.err && g.helpClosed && /^Read 2 projects: Order intake A, Order call B\./.test(g.read) && /1 named step has no system/.test(g.read) &&
      JSON.stringify(g.zipLeft) === '["Order call B v1.zip"]' &&
      JSON.stringify(g.view.map((x) => x.app)) === '["Salesforce","Excel","Phone"]' &&
      !!conflict && conflict.note === "The same screens, named differently: tick the one to keep." &&
      JSON.stringify(conflict.rows.map((r) => [r.name, r.ticked])) === '[["Save the order",true],["Book the order",false],["Save the order",false]]' &&
      /^In the library\. Screens: Salesforce - Order · save-order\.$/.test(conflict.rows[0].meta) &&
      /Once, in Order call B\.$/.test(conflict.rows[1].meta) && /^Named as in the library/.test(conflict.rows[2].meta) &&
      !JSON.stringify(g.view).includes("Account lookup: Search"),
    JSON.stringify({ err: g.err, read: g.read, zipLeft: g.zipLeft, view: g.view }));
  const libDoc = g.saved;
  const excel = libDoc && (libDoc.applications.find((x) => x.name === "Excel") || { activities: [] }).activities;
  const saveOrder = libDoc && ((libDoc.applications.find((x) => x.name === "Salesforce") || { activities: [] }).activities.find((x) => x.id === "sf-save-order"));
  record("(g) a conflict ticked is refused with the reason and nothing is written; Save library... offers the app's library file and writes a valid library: format 1, a new version (the date and 1), the new activity with its code and screens, the library's activities and applications kept",
    !g.err && /one run of screens belongs to the activities "sf-save-order" and /.test(g.refused) && g.savedAfterRefusal === false &&
      g.asked.defaultPath === LIB && !!libDoc && Library.problems(libDoc).length === 0 && libDoc.format === 1 &&
      /^\d{4}-\d{2}-\d{2}\.1$/.test(libDoc.version) &&
      JSON.stringify(libDoc.applications.map((x) => x.name)) === '["Salesforce","SAP","Excel","Phone"]' &&
      JSON.stringify(excel) === JSON.stringify([{ id: "excel-update-the-tracker", name: "Update the tracker", code: "EX-01", screens: [[K_EXCEL]] }]) &&
      saveOrder && JSON.stringify(saveOrder.screens) === JSON.stringify([[K_ORDER]]) &&
      /^Saved Library \d{4}-\d{2}-\d{2}\.1 \(4 applications, 5 activities\) to /.test(g.toast),
    JSON.stringify({ refused: g.refused, asked: g.asked, version: libDoc && libDoc.version, apps: libDoc && libDoc.applications, toast: g.toast }));

  record("no page error", errs.length === 0, errs.slice(0, 5).join(" | "));
  const nativeDialogs = await app.evaluate(() => (global.__dialogs || []).length).catch(() => -1);
  console.log("[library-e2e] dialogs answered by the stubs without a path: " + nativeDialogs);

  await v.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed, ${results.length - passed} failed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("[library-e2e] crash:", e && e.stack ? e.stack : e); process.exit(2); });
