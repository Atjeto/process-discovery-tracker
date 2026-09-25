"use strict";
// The end summary (end-summary-window.js + ui/end-summary.html) and the
// recording-folder guards its acts use (session.js).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSummaryHtml } = require("../end-summary-window.js");
const { summaryModel } = require("../capture-guidance.js");
const { createSession, isRecordingFolder, removeSessionFolder } = require("../session.js");
const { zipPathFor } = require("../zip-folder.js");

const PAGE = fs.readFileSync(path.join(__dirname, "..", "ui", "end-summary.html"), "utf-8");

function scriptOf(html) {
  return html.slice(html.lastIndexOf("<script>"));
}

test("the summary offers the hand-off: Show the folder, Make a zip for the analyst, a name, Done", () => {
  for (const kept of ["Recording saved", "Show the folder", "Make a zip for the analyst",
    "Name this recording (optional)", "Done", "pdt:zipFolder", "pdt:showFolder", "pdt:setSessionLabel"]) {
    assert.ok(PAGE.includes(kept), "missing: " + kept);
  }
  assert.ok(!/interaction|Interactions|Screenshots|Session complete/.test(PAGE), "no counts, no session words");
  assert.ok(!/https?:|mailto:|fetch\(|WebSocket/.test(PAGE), "nothing is sent from the summary");
});

test("lane FX3: the name comes before Make a zip, so a name typed there is in the zip", () => {
  const name = PAGE.indexOf('<input id="name"'), zip = PAGE.indexOf('id="btn-zip"');
  assert.ok(name > 0 && zip > 0 && name < zip, "the name field is above the zip button");
  assert.ok(PAGE.indexOf("Name this recording (optional)") < zip);
  // The zip saves the name first (as before), so the zip carries it.
  assert.match(PAGE, /await saveName\(\);\s*const r = await ipcRenderer\.invoke\("pdt:zipFolder", S\.folder\);/);
});

test("lane FX3: a pause is said in the summary, and the time left out of the duration", () => {
  const html = buildSummaryHtml(summaryModel({ runs: 4, durationMs: 77000, pausedMs: 6200, sessionFolder: "D:\\r\\default\\x" }));
  assert.ok(scriptOf(html).includes("4 transactions, 1:17 (paused 0:06, not counted)"));
});

test("the no-transaction warning reaches the page; a recording with transactions has none", () => {
  const noRun = summaryModel({ runs: 0, durationMs: 5000, sessionFolder: "D:\\r\\default\\x", hotkey: "Control+Shift+S" });
  const html = buildSummaryHtml(noRun);
  assert.ok(scriptOf(html).includes("No transaction was marked"), "the warning is in the page's model");
  assert.match(PAGE, /if \(S\.warning\) \{\s*\$\("warning"\)\.textContent = S\.warning;\s*\$\("warning"\)\.hidden = false;/);
  const withRuns = buildSummaryHtml(summaryModel({ runs: 2, durationMs: 5000, sessionFolder: "D:\\r\\default\\x" }));
  assert.ok(!scriptOf(withRuns).includes("No transaction was marked"));
});

test("a folder path cannot break out of the summary's script", () => {
  const html = buildSummaryHtml({ headline: "1 transaction, 0:05", folder: "C:\\x\\</script><img src=x onerror=alert(1)>", warning: null });
  const script = scriptOf(html);
  assert.ok(!script.includes("<img"), "no raw markup from the model");
  assert.ok(!html.includes("{{SUMMARY}}"), "the slot is filled");
});

test("the summary's acts touch only a recording folder under the recordings folder", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-summary-"));
  try {
    const s = createSession({ baseDir: base, engagementId: "default", config: {} });
    assert.strictEqual(isRecordingFolder(base, s.sessionFolder), true);
    assert.strictEqual(isRecordingFolder(base, path.dirname(s.sessionFolder)), false, "the request folder");
    assert.strictEqual(isRecordingFolder(base, base), false, "the recordings folder itself");
    assert.strictEqual(isRecordingFolder(base, path.join(s.sessionFolder, "screenshots")), false, "a subfolder");
    assert.strictEqual(isRecordingFolder(base, path.join(base, "..", "elsewhere", "x")), false, "outside");
    assert.strictEqual(isRecordingFolder(base, os.tmpdir()), false);
    assert.strictEqual(isRecordingFolder(base, ""), false);
    assert.strictEqual(isRecordingFolder(base, null), false);
    const noManifest = path.join(base, "default", "20000101-000000");
    fs.mkdirSync(noManifest, { recursive: true });
    assert.strictEqual(isRecordingFolder(base, noManifest), false, "no manifest.json");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("deleting a recording also deletes the zip made for the analyst", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-summary-"));
  try {
    const s = createSession({ baseDir: base, engagementId: "default", config: {} });
    const other = path.join(base, "default", "keep.zip");
    fs.writeFileSync(zipPathFor(s.sessionFolder), "zip");
    fs.writeFileSync(other, "not this recording's zip");
    removeSessionFolder(s.sessionFolder);
    assert.ok(!fs.existsSync(s.sessionFolder));
    assert.ok(!fs.existsSync(zipPathFor(s.sessionFolder)));
    assert.ok(fs.existsSync(other), "another file is left alone");
    removeSessionFolder(s.sessionFolder); // a second delete is harmless
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
