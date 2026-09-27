"use strict";
// The PDD of a project with attachments, as one zip (pdd-zip.js, 2.0.1): the
// files it carries and the zip read back entry by entry. The real Export
// menu and the links inside the PDD are in e2e/handoff-smoke.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const PZ = require("./pdd-zip.js");

/* The zip's entries, { name: Buffer }, read from its central directory. */
function entries(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
  }
  return out;
}

function project() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-pdd-zip-test-"));
  const root = path.join(base, "Order to cash");
  fs.mkdirSync(path.join(root, "attachments"), { recursive: true });
  fs.writeFileSync(path.join(root, "attachments", "Material mapping.txt"), "OC-7 MAT-1007\n");
  fs.writeFileSync(path.join(root, "attachments", "Überweisung.csv"), "sku,qty\nA-1,4\n");
  return { base, root };
}

test("attachedFiles: the project's attached files in its attachments folder, each once; a missing file or a path is left out", () => {
  const { base, root } = project();
  try {
    const files = PZ.attachedFiles(root, [
      { file: "Material mapping.txt", step_id: "s1" },
      { file: "Überweisung.csv", step_id: null },
      { file: "material mapping.txt" },
      { file: "gone.pdf" },
      { file: "../annotations.json" },
      { file: "attachments/Material mapping.txt" },
      null, "x",
    ]);
    assert.deepEqual(files.map((f) => f.name), ["Material mapping.txt", "Überweisung.csv"]);
    assert.equal(files[0].path, path.join(root, "attachments", "Material mapping.txt"));
    assert.deepEqual(PZ.attachedFiles(root, undefined), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("writePddZip: one folder holding the PDD and Attachments/ with the files, the PDD's link folder; nothing left behind", async () => {
  const { base, root } = project();
  try {
    const pdd = path.join(base, "made.docx");
    fs.writeFileSync(pdd, Buffer.from("PK fake docx"));
    const zipPath = path.join(base, "Order to cash PDD.zip");
    fs.writeFileSync(zipPath, "an older zip the analyst chose to replace");
    const files = PZ.attachedFiles(root, [{ file: "Material mapping.txt" }, { file: "Überweisung.csv" }]);
    const r = await PZ.writePddZip({ pdd, name: "Order to cash PDD", files, zipPath });
    assert.deepEqual(r, { zipPath, files: 2 });
    const e = entries(zipPath);
    assert.deepEqual(Object.keys(e).filter((n) => !n.endsWith("/")).sort(), [
      "Order to cash PDD/Attachments/Material mapping.txt",
      "Order to cash PDD/Attachments/Überweisung.csv",
      "Order to cash PDD/Order to cash PDD.docx",
    ]);
    assert.equal(e["Order to cash PDD/Order to cash PDD.docx"].toString(), "PK fake docx");
    assert.equal(e["Order to cash PDD/Attachments/Material mapping.txt"].toString(), "OC-7 MAT-1007\n");
    assert.equal(PZ.ATTACHMENTS_DIR, "Attachments");
    assert.equal(fs.readdirSync(base).filter((n) => n.endsWith(".building") || n.endsWith(".partial")).length, 0,
      "nothing left beside the zip");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("writePddZip: a zip that fails leaves no file under the name the analyst chose", async () => {
  const { base, root } = project();
  try {
    const pdd = path.join(base, "made.docx");
    fs.writeFileSync(pdd, "PK");
    const zipPath = path.join(base, "PDD.zip");
    await assert.rejects(PZ.writePddZip({ pdd, name: "PDD", files: PZ.attachedFiles(root, [{ file: "Material mapping.txt" }]), zipPath },
      { zipFolder: async () => { throw new Error("disk full"); } }), /disk full/);
    assert.ok(!fs.existsSync(zipPath) && !fs.existsSync(zipPath + ".building"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
