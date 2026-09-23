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

/* Launch the viewer (playwright-core's _electron) on a fresh throwaway
   profile. opts = { executablePath, cwd, args } exactly as electron.launch
   takes them; the --user-data-dir switch is appended. Resolves to
   { app, profileDir, close } where close() quits the app and removes the
   directory. Throws, naming both paths, if Electron is not using it. */
async function launchViewer(electron, opts) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-e2e-profile-"));
  _live.add(profileDir);
  const app = await electron.launch({
    executablePath: opts.executablePath,
    cwd: opts.cwd,
    args: [...(opts.args || []), "--user-data-dir=" + profileDir],
  });
  const actual = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
  if (!_samePath(actual, profileDir)) {
    await app.close().catch(() => {});
    removeProfileDir(profileDir);
    throw new Error("the viewer is not on the throwaway profile: userData is " + actual +
      ", expected " + profileDir);
  }
  return {
    app,
    profileDir,
    async close() {
      await app.close().catch((e) => console.log("[e2e] app.close failed: " + e.message));
      removeProfileDir(profileDir);
    },
  };
}

module.exports = { launchViewer, removeProfileDir };
