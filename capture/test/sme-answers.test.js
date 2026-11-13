"use strict";
// What the SME gives at the end (contract C24): sme-answers.js and the end
// summary's questions and example files (ui/end-summary.html).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const sme = require("../sme-answers.js");
const { createSession, closeSession, writeSessionIntegrity } = require("../session.js");
const { zipRecording } = require("../recording-zip.js");
const { fitContentHeight, HEIGHT, HEIGHT_WITH_WARNING } = require("../end-summary-window.js");

const PAGE = fs.readFileSync(path.join(__dirname, "..", "ui", "end-summary.html"), "utf-8");

function recording() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-sme-"));
  const s = createSession({ baseDir: base, engagementId: "default", config: {} });
  closeSession({ sessionFolder: s.sessionFolder, status: "closed" });
  writeSessionIntegrity(s.sessionFolder);
  return { base, folder: s.sessionFolder };
}
const manifestOf = (folder) => JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf-8"));
function sources(base, files) {
  const dir = path.join(base, "picked");
  const out = [];
  for (const [rel, body] of files) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    out.push(p);
  }
  return out;
}

/* Every entry of a zip by its central directory, inflated when deflated. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.slice(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
  }
  return out;
}

test("the answers: four keys in C24's order, trimmed, at most 300, the empty ones left out", () => {
  assert.deepStrictEqual(sme.QUESTIONS.map((q) => q.key), ["trigger", "result", "effort", "exceptions"]);
  const clean = sme.cleanAnswers({ effort: "  40 a day  ", trigger: " An order e-mail ", result: "   ",
    exceptions: "", other: "not asked", label: "x" });
  assert.deepStrictEqual(clean, { trigger: "An order e-mail", effort: "40 a day" });
  assert.deepStrictEqual(Object.keys(clean), ["trigger", "effort"], "the order of the questions");
  assert.strictEqual(sme.cleanAnswers({ trigger: "x".repeat(400) }).trigger.length, 300);
  assert.strictEqual(sme.cleanAnswers({ trigger: "x".repeat(300) }).trigger.length, 300);
  assert.strictEqual(sme.cleanAnswers({ trigger: "a\r\nb" }).trigger, "a b", "one line");
  assert.strictEqual(sme.cleanAnswers({ trigger: 42, result: null }), null, "only text is an answer");
  assert.strictEqual(sme.cleanAnswers({}), null);
  assert.strictEqual(sme.cleanAnswers(null), null);
});

test("the name rule: the file's own name, else (2), (3) before the extension, without case", () => {
  assert.strictEqual(sme.uniqueName("Order 10900.msg", []), "Order 10900.msg");
  assert.strictEqual(sme.uniqueName("Order 10900.msg", ["Order 10900.msg"]), "Order 10900 (2).msg");
  assert.strictEqual(sme.uniqueName("Order 10900.msg", ["order 10900.MSG", "Order 10900 (2).msg"]), "Order 10900 (3).msg");
  assert.strictEqual(sme.uniqueName("Prices.tar.gz", ["Prices.tar.gz"]), "Prices.tar (2).gz");
  assert.strictEqual(sme.uniqueName("README", ["README"]), "README (2)");
  assert.strictEqual(sme.uniqueName(".profile", [".profile"]), ".profile (2)");
});

test("the limits: 20 files, 50 MB each, refused in a sentence naming the file", () => {
  const MB = 1024 * 1024;
  assert.strictEqual(sme.MAX_FILES, 20);
  assert.strictEqual(sme.MAX_FILE_BYTES, 50 * MB);
  assert.strictEqual(sme.refusal({ name: "a.pdf", size: 50 * MB }, 0), null, "50 MB is allowed");
  assert.strictEqual(sme.refusal({ name: "a.pdf", size: 1 }, 19), null, "the 20th file is allowed");
  assert.strictEqual(sme.refusal({ name: "Scan.pdf", size: 60 * MB }, 0),
    '"Scan.pdf" was not added: it is 60 MB, and an example file can be at most 50 MB.');
  assert.match(sme.refusal({ name: "a.pdf", size: 50 * MB + 1 }, 0), /^"a\.pdf" was not added: it is 50 MB, and/);
  assert.strictEqual(sme.refusal({ name: "b.xlsx", size: 1 }, 20),
    '"b.xlsx" was not added: a recording holds at most 20 example files.');
  assert.strictEqual(sme.megabytes(52848230), "50.4 MB");
});

test("setSmeAnswers writes sme_answers on the manifest, and the integrity list stays true", () => {
  const { base, folder } = recording();
  try {
    sme.setSmeAnswers(folder, { trigger: "  An order e-mail ", effort: " 40 a day " });
    assert.deepStrictEqual(manifestOf(folder).sme_answers, { trigger: "An order e-mail", effort: "40 a day" });
    const listed = JSON.parse(fs.readFileSync(path.join(folder, "session-integrity.json"), "utf-8"))
      .files.find((f) => f.name === "manifest.json");
    assert.strictEqual(listed.size, fs.statSync(path.join(folder, "manifest.json")).size);
    sme.setSmeAnswers(folder, { trigger: " ", effort: "" });
    assert.ok(!("sme_answers" in manifestOf(folder)), "four empty answers leave the key out");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("addSmeFiles copies into attachments/ with the name rule, and refuses past the limits", async () => {
  const { base, folder } = recording();
  try {
    const picked = sources(base, [["a/Order 10900.msg", "A"], ["b/Order 10900.msg", "B"], ["Big.pdf", "x".repeat(11)], ["c.txt", "c"]]);
    const r = await sme.addSmeFiles(folder, picked, { maxFiles: 3, maxBytes: 10 });
    assert.deepStrictEqual(r.files.map((f) => [f.file, f.label]),
      [["Order 10900.msg", "Order 10900.msg"], ["Order 10900 (2).msg", "Order 10900.msg"], ["c.txt", "c.txt"]]);
    assert.ok(r.files.every((f) => !Number.isNaN(Date.parse(f.added_at))), "added_at is a time");
    assert.deepStrictEqual(r.refused, ['"Big.pdf" was not added: it is 0 MB, and an example file can be at most 0 MB.']);
    assert.strictEqual(fs.readFileSync(path.join(folder, "attachments", "Order 10900 (2).msg"), "utf-8"), "B");
    assert.deepStrictEqual(manifestOf(folder).sme_files, r.files);
    const more = await sme.addSmeFiles(folder, sources(base, [["d.txt", "d"]]), { maxFiles: 3, maxBytes: 10 });
    assert.deepStrictEqual(more.refused, ['"d.txt" was not added: a recording holds at most 3 example files.']);
    assert.strictEqual(more.files.length, 3);
    const gone = await sme.addSmeFiles(folder, [path.join(base, "no such file.txt")]);
    assert.deepStrictEqual(gone.refused, ['"no such file.txt" was not added: it could not be read.']);
    const integrity = JSON.parse(fs.readFileSync(path.join(folder, "session-integrity.json"), "utf-8"));
    assert.ok(integrity.files.some((f) => f.name === "attachments/Order 10900 (2).msg"), "the copies are on the integrity list");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("removeSmeFile deletes only a listed file, only inside attachments/", async () => {
  const { base, folder } = recording();
  try {
    await sme.addSmeFiles(folder, sources(base, [["Order.msg", "o"], ["Prices.xlsx", "p"]]));
    fs.writeFileSync(path.join(folder, "attachments", "analyst.docx"), "not the SME's");
    for (const bad of ["analyst.docx", "../manifest.json", "..\\manifest.json", "..", "", null, 7, "attachments/Order.msg"]) {
      assert.strictEqual(sme.removeSmeFile(folder, bad).length, 2, "refused: " + bad);
    }
    assert.ok(fs.existsSync(path.join(folder, "manifest.json")));
    assert.ok(fs.existsSync(path.join(folder, "attachments", "analyst.docx")));
    const left = sme.removeSmeFile(folder, "Order.msg");
    assert.deepStrictEqual(left.map((f) => f.file), ["Prices.xlsx"]);
    assert.ok(!fs.existsSync(path.join(folder, "attachments", "Order.msg")));
    fs.rmSync(path.join(folder, "attachments", "analyst.docx"));
    sme.removeSmeFile(folder, "Prices.xlsx");
    assert.ok(!("sme_files" in manifestOf(folder)), "the last file out leaves the key out");
    assert.ok(!fs.existsSync(path.join(folder, "attachments")), "an empty attachments/ goes too");
    const integrity = JSON.parse(fs.readFileSync(path.join(folder, "session-integrity.json"), "utf-8"));
    assert.ok(!integrity.files.some((f) => f.name.startsWith("attachments/")), "the integrity list drops them");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the handlers act only on a recording folder, and never open the dialog for another", async () => {
  const { base, folder } = recording();
  try {
    let opened = 0;
    const h = sme.smeHandlers({ getBaseDir: () => base, pickFiles: async () => { opened += 1; return []; } });
    const outside = path.dirname(folder);
    assert.strictEqual(h.setAnswers(null, outside, { trigger: "x" }), false);
    assert.ok(!fs.existsSync(path.join(outside, "manifest.json")));
    const add = await h.addFiles({}, base);
    assert.strictEqual(add.ok, false);
    assert.strictEqual(opened, 0, "no dialog for a folder that is not a recording");
    assert.strictEqual(h.removeFile(null, os.tmpdir(), "x").ok, false);
    assert.strictEqual(h.setAnswers(null, folder, { result: " A sales order " }), true);
    assert.deepStrictEqual(manifestOf(folder).sme_answers, { result: "A sales order" });
    const none = await h.addFiles({}, folder);
    assert.deepStrictEqual(none, { ok: true, files: [], refused: [] }, "a cancelled dialog changes nothing");
    assert.strictEqual(opened, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the zip carries the answers and exactly the example files left", async () => {
  const { base, folder } = recording();
  try {
    sme.setSmeAnswers(folder, { trigger: " An order e-mail ", exceptions: " A new customer " });
    await sme.addSmeFiles(folder, sources(base, [["a/Order.msg", "A"], ["b/Order.msg", "B"]]));
    sme.removeSmeFile(folder, "Order.msg");
    const r = await zipRecording(folder);
    const entries = readZip(r.zipPath);
    const root = path.basename(folder) + "/";
    const m = JSON.parse(entries[root + "manifest.json"].toString("utf8"));
    assert.deepStrictEqual(m.sme_answers, { trigger: "An order e-mail", exceptions: "A new customer" });
    assert.deepStrictEqual(m.sme_files.map((f) => [f.file, f.label]), [["Order (2).msg", "Order.msg"]]);
    assert.deepStrictEqual(Object.keys(entries).filter((n) => n.startsWith(root + "attachments/") && !n.endsWith("/")),
      [root + "attachments/Order (2).msg"]);
    assert.strictEqual(entries[root + "attachments/Order (2).msg"].toString(), "B");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the end summary asks the four questions in C24's words and order, each with its label", () => {
  assert.ok(PAGE.includes("For the analyst (optional, one line each)"));
  let at = PAGE.indexOf('<input id="name"');
  for (const q of sme.QUESTIONS) {
    const id = "q-" + q.key;
    const label = PAGE.indexOf('<label for="' + id + '">' + q.label + "</label>");
    const input = PAGE.indexOf('<input id="' + id + '" data-key="' + q.key + '" maxlength="300"');
    assert.ok(label > at && input > label, "in order, labelled: " + q.key);
    at = input;
  }
  assert.ok(at < PAGE.indexOf("Saved in this folder"), "between the name and the folder");
  assert.match(PAGE, /ipcRenderer\.invoke\("pdt:setSmeAnswers", S\.folder, answers\)/);
  assert.match(PAGE, /for \(const q of questions\) q\.addEventListener\("blur", saveAnswers\);/);
  assert.match(PAGE, /await saveAnswers\(\);\s*await saveName\(\);\s*const r = await ipcRenderer\.invoke\("pdt:zipFolder"/, "saved before the zip");
  assert.match(PAGE, /\$\("btn-done"\)\.addEventListener\("click", async \(\) => \{\s*await saveAnswers\(\);/, "saved on Done");
  assert.match(PAGE, /e\.key === "Escape"\) saveAnswers\(\)\.then\(saveName\)/, "saved on Escape");
});

test("the end summary takes example files: the words, the alert, the channels", () => {
  for (const kept of [
    "Example files (an e-mail, a sheet, a form)",
    '<button id="btn-add-file" title="Copies a file into the recording, for the analyst.">Add an example file...</button>',
    'remove.title = "Takes this file out of the recording.";',
    'id="files-error" role="alert"',
    '<div class="note" id="note"></div>',
    'ipcRenderer.invoke("pdt:addSmeFiles", S.folder)',
    'ipcRenderer.invoke("pdt:removeSmeFile", S.folder, file)',
  ]) {
    assert.ok(PAGE.includes(kept), "missing: " + kept);
  }
  assert.ok(PAGE.indexOf('id="btn-add-file"') < PAGE.indexOf('id="btn-zip"'), "the files come before the zip");
  assert.ok(!/innerHTML/.test(PAGE), "file names are text, never markup");
});

test("the window fits a 1366 x 768 screen: as tall as its work area, the page scrolling", () => {
  assert.strictEqual(fitContentHeight(HEIGHT, 728, 39), 689, "1366 x 768 with the taskbar");
  assert.strictEqual(fitContentHeight(HEIGHT, 1032, 39), HEIGHT, "1920 x 1080 holds it");
  assert.strictEqual(fitContentHeight(HEIGHT_WITH_WARNING, 1032, 39), HEIGHT_WITH_WARNING);
  assert.strictEqual(fitContentHeight(HEIGHT, undefined, 39), HEIGHT, "no screen information");
  assert.ok(!/overflow:\s*hidden/.test(PAGE), "the page can scroll");
});

test("every capture page marks the focus: a 2 px outline in the accent, never outline: none", () => {
  const dir = path.join(__dirname, "..", "ui");
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(dir, name), "utf-8");
    assert.ok(!/outline:\s*none/.test(html), name + ": outline: none");
    if (!/<(button|input|select|textarea|a)\b/.test(html)) continue; // Help has no control
    assert.match(html, /:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/, name);
    assert.match(html, /--accent:\s*#6E8A66/, name + " defines the accent");
  }
});
