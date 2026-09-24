"use strict";
/*
 * throwaway-profile.js: every e2e smoke launches the viewer on its own,
 * temporary Electron user-data directory (RP-36).
 *
 * Without it the smokes shared the developer's persisted UI state
 * (localStorage: the Session summary open state, the recent sessions list,
 * module collapse keys, ...). They overwrote it, and a check could pass or
 * fail depending on what a previous human session left behind (CI-3 did).
 *
 * Mechanism: Chromium's --user-data-dir switch. Electron honors it for
 * app.getPath("userData") and for the renderer's Local Storage, so no
 * viewer change is needed. launchViewer() VERIFIES that after launch and
 * throws when the viewer is not on the throwaway directory, so a smoke can
 * never silently run on (and overwrite) the developer profile.
 *
 * Each directory lives under the OS temp dir and is removed after the app
 * closes; a process exit hook removes any directory a crashed run left.
 *
 * Window size (L5b). launchViewer() also sets the size every smoke runs at:
 * the window CONTENT size (the page area, without the title bar and the
 * borders) is 1500x950 by default, or the size the PDT_E2E_WINDOW environment
 * variable names as "<width>x<height>", for example
 *     PDT_E2E_WINDOW=1366x768 node session-smoke.js
 * so a check can be run the way a small laptop or a CI runner's small desktop
 * shows the viewer. It sizes the real BrowserWindow (setContentSize), not an
 * emulated viewport, and waits until the page sees the new size. Windows can
 * refuse a window larger than the display, so every launch logs one line with
 * the primary display's work area, the window content size and the page's
 * innerWidth x innerHeight and devicePixelRatio: that line, not the request,
 * is the size a run was checked at.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const _live = new Set();

function removeProfileDir(dir) {
  try {
    // maxRetries: Electron's helper processes can hold profile files for a
    // moment after app.close() on Windows.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    _live.delete(dir);
  } catch (e) {
    console.log("[e2e] WARNING: could not remove the throwaway profile " + dir + ": " + e.message);
  }
}

process.on("exit", () => {
  for (const dir of [..._live]) removeProfileDir(dir);
});

function _samePath(a, b) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

const DEFAULT_WINDOW = { width: 1500, height: 950 };

/* The window content size a run asks for: PDT_E2E_WINDOW ("1366x768") or the
   1500x950 default. A value that does not parse is an error, never a silent
   fall back to the default (a run would then claim a size it never used). */
function requestedWindowSize() {
  const raw = process.env.PDT_E2E_WINDOW;
  if (raw === undefined || raw.trim() === "") return Object.assign({ source: "default" }, DEFAULT_WINDOW);
  const m = /^\s*(\d{3,5})\s*[xX]\s*(\d{3,5})\s*$/.exec(raw);
  if (!m) throw new Error('PDT_E2E_WINDOW must be "<width>x<height>", for example 1366x768; got ' + JSON.stringify(raw));
  return { width: Number(m[1]), height: Number(m[2]), source: "PDT_E2E_WINDOW" };
}

/* Size the viewer's window to the requested content size, wait until the
   page sees it, and log the one environment line. Returns what the page got. */
async function sizeWindow(app, want) {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const win = await app.evaluate(({ BrowserWindow, screen }, s) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return { err: "no BrowserWindow" };
    if (w.isMaximized()) w.unmaximize();
    w.setContentSize(s.width, s.height);
    const d = screen.getPrimaryDisplay();
    return { workArea: d.workAreaSize, scale: d.scaleFactor, content: w.getContentSize() };
  }, { width: want.width, height: want.height });
  if (win.err) throw new Error("could not size the viewer window: " + win.err);
  const [cw, ch] = win.content;
  // The resize reaches the renderer asynchronously; wait for the page to see
  // it. If it never does, the line below says so and shows what the page got.
  const settled = await page.waitForFunction(([w, h]) => Math.abs(window.innerWidth - w) <= 1 && Math.abs(window.innerHeight - h) <= 1,
    [cw, ch], { timeout: 10000 }).then(() => true, () => false);
  const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
  console.log("[e2e] window: display work area " + win.workArea.width + "x" + win.workArea.height +
    " (scale " + win.scale + "); content " + cw + "x" + ch + " (requested " + want.width + "x" + want.height +
    ", " + want.source + "); page " + inner.w + "x" + inner.h + " @ devicePixelRatio " + inner.dpr +
    (settled ? "" : " (the page did not reach the content size within 10 s)"));
  return { requested: want, content: { width: cw, height: ch }, page: { width: inner.w, height: inner.h, dpr: inner.dpr } };
}

/* Launch the viewer (playwright-core's _electron) on a fresh throwaway
   profile, at the window size above. opts = { executablePath, cwd, args }
   exactly as electron.launch takes them; the --user-data-dir switch is
   appended. Resolves to { app, profileDir, windowSize, close } where close()
   quits the app and removes the directory. Throws, naming both paths, if
   Electron is not using it. */
/* The viewer process's last output lines and its exit, kept so a launch that
   fails can say what the app printed before it went (CI-only launch failures
   were otherwise a bare "Execution context was destroyed"). */
function watchProcess(app) {
  const tail = [];
  const state = { exit: null, tail };
  const child = app.process && app.process();
  if (!child) return state;
  const keep = (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > 60) tail.shift();
    }
  };
  if (child.stdout) child.stdout.on("data", keep);
  if (child.stderr) child.stderr.on("data", keep);
  child.on("exit", (code, signal) => { state.exit = { code, signal }; });
  return state;
}

async function launchOnce(electron, opts, want) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-e2e-profile-"));
  _live.add(profileDir);
  const app = await electron.launch({
    executablePath: opts.executablePath,
    cwd: opts.cwd,
    // On the CI runner (no GPU) the viewer runs without the GPU process: the
    // panel smoke froze there in a map tap, run after run, with every process
    // idle and the page answering nothing (BH13); no local run ever did.
    args: [...(opts.args || []), ...(process.env.CI ? ["--disable-gpu"] : []), "--user-data-dir=" + profileDir],
  });
  const watch = watchProcess(app);
  let windowSize;
  try {
    const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
    if (!_samePath(actual, profileDir)) {
      const err = new Error("the viewer is not on the throwaway profile: userData is " + actual +
        ", expected " + profileDir);
      err.notRetryable = true;
      throw err;
    }
    windowSize = await sizeWindow(app, want);
  } catch (e) {
    // Give an exiting process a moment to report its exit code.
    await new Promise((r) => setTimeout(r, 500));
    console.log("[e2e] launch failed: " + String((e && e.message) || e).split("\n")[0] +
      "\n    viewer process: " + (watch.exit ? "exited (code " + watch.exit.code + ", signal " + watch.exit.signal + ")" : "still running") +
      "\n    its last output:\n" + (watch.tail.length ? watch.tail.map((l) => "      " + l).join("\n") : "      (none)"));
    await app.close().catch(() => {});
    removeProfileDir(profileDir);
    throw e;
  }
  return { app, profileDir, windowSize };
}

async function launchViewer(electron, opts) {
  const want = requestedWindowSize();   // a bad PDT_E2E_WINDOW fails before anything launches
  let launched;
  try {
    launched = await launchOnce(electron, opts, want);
  } catch (e) {
    if (e && e.notRetryable) throw e;
    // One retry: the failure and the process's last output are logged above,
    // so a launch race on a slow runner is visible without failing the run.
    console.log("[e2e] retrying the launch once");
    launched = await launchOnce(electron, opts, want);
  }
  const { app, profileDir, windowSize } = launched;
  return {
    app,
    profileDir,
    windowSize,
    async close() {
      await app.close().catch((e) => console.log("[e2e] app.close failed: " + e.message));
      removeProfileDir(profileDir);
    },
  };
}

/* A failed Playwright action's WHOLE message. Its first line only says
   "Timeout exceeded"; the call log below it says why the action could not
   run (another element receives the click, outside of the viewport, not
   visible, not stable). The smokes keep a one-line detail in their result
   line and print this block for every failed action. */
function logActionError(where, e) {
  // Playwright colors its call log; a CI log shows the codes as text.
  const msg = String((e && e.message) || e).replace(/\x1b\[[0-9;]*m/g, "");
  console.log("[e2e] action failed: " + where + "\n" + msg.replace(/^/gm, "    "));
}

module.exports = { launchViewer, removeProfileDir, logActionError };
