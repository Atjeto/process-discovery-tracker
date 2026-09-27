"use strict";

/*
 * pdd-zip.js: the PDD of a project with attachments, in the main process
 * (2.0.1, the owner: "attachments, that contain business data, need to go
 * with the PDD"). Export, PDD then saves "<project> PDD.zip": one folder,
 * "<project> PDD", holding the PDD and an Attachments folder with the
 * project's attached files. The PDD's attachment names link into that folder
 * (normalize.py --pdd-attachments Attachments), so whoever extracts the zip
 * opens each file from the document. A project without attachments exports
 * the .docx alone (renderer.js exportArtifact).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipFolder } = require("./zip-folder.js");
const { attachmentTarget } = require("./analyst-files.js");

/* The folder beside the PDD its attachments travel in, as the PDD links it. */
const ATTACHMENTS_DIR = "Attachments";

/* The attached files of the project at `root` (annotations.attachments):
   [{ name, path }], each file once, only the ones in its attachments
   folder. `exists` is fs.existsSync (a fake in the tests). */
function attachedFiles(root, attachments, exists) {
  const has = exists || fs.existsSync;
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(attachments) ? attachments : []) {
    const t = a && typeof a === "object" ? attachmentTarget(root, a.file, has) : null;
    if (!t || !t.ok) continue;
    const name = path.basename(t.path);
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, path: t.path });
  }
  return out;
}

/* Write the zip at `zipPath`: the folder `name` holding "<name>.docx" (the
   PDD at `pdd`) and Attachments/ with `files`. Built as "<zip>.building" and
   renamed once complete, so no half zip carries the name. Resolves
   { zipPath, files } (how many files it carries). deps (the tests):
   { zipFolder }. */
async function writePddZip({ pdd, name, files, zipPath }, deps) {
  const zip = (deps && deps.zipFolder) || zipFolder;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-pdd-zip-"));
  const dir = path.join(stage, name);
  const building = zipPath + ".building";
  try {
    fs.mkdirSync(path.join(dir, ATTACHMENTS_DIR), { recursive: true });
    fs.copyFileSync(pdd, path.join(dir, name + ".docx"));
    for (const f of files || []) fs.copyFileSync(f.path, path.join(dir, ATTACHMENTS_DIR, f.name));
    await zip(dir, building);
    fs.rmSync(zipPath, { force: true });
    fs.renameSync(building, zipPath);
    return { zipPath, files: (files || []).length };
  } finally {
    fs.rmSync(building, { force: true });
    fs.rmSync(building + ".partial", { force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { ATTACHMENTS_DIR, attachedFiles, writePddZip };
