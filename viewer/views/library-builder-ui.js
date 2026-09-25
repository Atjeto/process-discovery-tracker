/*
 * library-builder-ui.js: the Library builder (contract C21), the owner's
 * tool: Help, Build the library... One dialog:
 *   Add projects... and Add hand-off zips... (main.js reads annotations.json
 *   and manifest.json of each, a zip where it is, never extracted);
 *   the named steps by application, a row each (library-builder.js rows): a
 *   tick, the name, the code and the description to fix, and one line on
 *   its screens and where it was found; the same screens named differently
 *   side by side, marked, so the owner ticks the one to keep;
 *   Save library... makes the new library of the ticked rows (a new version,
 *   the date and a counter), checks it as the pipeline does (library.js
 *   problems), and main.js writes it where the owner says, the app's own
 *   library file offered first.
 * It starts from the app's library: its activities are the first rows,
 * ticked. Nothing here touches the project that is open.
 */

"use strict";

const Ipc = require("../ipc.js");
const Library = require("../library.js");
const Builder = require("../library-builder.js");
const Handoff = require("../handoff.js");
const { escapeHtml, escapeAttr, toast } = require("../dom.js");

const DIALOG_ID = "library-builder";

function _plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* A source's name, as the app names the project (its document title, the
   name given at the end of the recording, else its folder or zip). */
function _sourceName(src) {
  const folder = String(src.path || "").replace(/\.zip$/i, "");
  return Handoff.projectName({ sessionFolder: folder, manifest: src.manifest || {}, annotations: src.annotations || {} });
}

/* The first line of the dialog: what it starts from. */
function _intro(base) {
  const from = base.status === "ok"
    ? "It starts from the app's library (" + Library.summaryLine(base) + ")."
    : base.status === "absent" ? "The app has no library yet: it starts from an empty one."
      : "The app's library cannot be read (" + (base.error || "no reason was given") + "): it starts from an empty one.";
  return from + " Add projects or hand-off zips: the steps their analysts named are listed by system. " +
    "Tick what goes in the library, fix the names, codes and descriptions, then save it as a new version.";
}

/* A row's line under its fields: where it comes from, its screens, and how
   often and where it was found. */
function _metaText(row) {
  const parts = [];
  if (row.source === "library") parts.push("In the library");
  if (row.inLibrary) parts.push("Named as in the library: ticked, its screens are added to that activity");
  parts.push(row.runs.length ? "Screens: " + Builder.screensText(row.runs) : "No screens: added by hand");
  const uses = Builder.usesText(row);
  if (uses) parts.push(uses);
  return parts.join(". ") + ".";
}

function _rowHtml(row) {
  const label = "Put " + row.name + " in the library";
  return '<div class="lb-row" data-key="' + escapeAttr(row.key) + '">' +
    '<input type="checkbox" class="lb-tick" aria-label="' + escapeAttr(label) + '" title="' + escapeAttr(label) + '"' + (row.ticked ? " checked" : "") + ">" +
    '<input type="text" class="lb-name" value="' + escapeAttr(row.name) + '" aria-label="Name" title="The activity\'s name">' +
    '<input type="text" class="lb-code" value="' + escapeAttr(row.code) + '" placeholder="Code" aria-label="Code" title="The activity\'s code (optional)">' +
    '<input type="text" class="lb-desc" value="' + escapeAttr(row.description) + '" placeholder="Description" aria-label="Description" title="The activity\'s description (optional): a step named from it takes it when it has none">' +
    '<p class="lb-meta">' + escapeHtml(_metaText(row)) + "</p>" +
    "</div>";
}

/* The list: an application's rows under its name, a conflict's rows in one
   marked cluster. */
function _listHtml(rows) {
  if (!rows.length) return '<p class="lb-app-empty">Add projects or hand-off zips to list the steps their analysts named.</p>';
  const out = [];
  let app = null, cluster = null;
  const closeCluster = () => { if (cluster !== null) { out.push("</div>"); cluster = null; } };
  const closeApp = () => { closeCluster(); if (app !== null) { out.push("</section>"); app = null; } };
  for (const r of rows) {
    if (r.application !== app) {
      closeApp();
      app = r.application;
      out.push('<section class="lb-app" data-app="' + escapeAttr(app) + '"><h3>' + escapeHtml(app) + "</h3>");
    }
    if (r.cluster !== cluster) {
      closeCluster();
      cluster = r.cluster;
      out.push('<div class="lb-cluster' + (r.conflict ? " conflict" : "") + '" data-cluster="' + r.cluster + '">' +
        (r.conflict ? '<p class="lb-conflict-note">The same screens, named differently: tick the one to keep.</p>' : ""));
    }
    out.push(_rowHtml(r));
  }
  closeApp();
  return out.join("");
}

/* Open the builder. Resolves when it is drawn. `onSaved(result)` is called
   after a save ({ path, library }). */
async function openLibraryBuilder(opts) {
  const o = opts || {};
  const prior = document.getElementById(DIALOG_ID);
  if (prior) prior.remove();
  let base;
  try { base = await Ipc.readAppLibrary(); } catch (e) { base = null; }
  if (!base || !base.library) base = { status: "invalid", library: Library.emptyLibrary(), error: "the app did not answer" };

  let sources = [];
  let rows = [];
  let noSystem = 0;
  const edits = new Map();   // row key -> { ticked, name, code, description } the owner set
  let lastRead = "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = DIALOG_ID;
  backdrop.innerHTML =
    '<div class="modal modal-simple lib-builder" role="dialog" aria-label="Build the library">' +
      '<header class="modal-header"><h2>Build the library</h2>' +
        '<button class="icon-btn modal-close" data-act="close" title="Close">✕</button></header>' +
      '<div class="modal-body">' +
        '<p class="meta lb-intro" id="lb-intro"></p>' +
        '<div class="lb-sources">' +
          '<button type="button" id="btn-lb-add-projects" title="Pick project folders: their annotations.json and manifest.json are read">Add projects...</button>' +
          '<button type="button" id="btn-lb-add-zips" title="Pick hand-off zips: each is read where it is, not unzipped">Add hand-off zips...</button>' +
        "</div>" +
        '<p class="lb-read" id="lb-read"></p>' +
        '<div id="lb-list"></div>' +
        '<p class="lb-error" id="lb-error" role="alert"></p>' +
      "</div>" +
      '<div class="modal-footer">' +
        '<span class="lb-count" id="lb-count"></span>' +
        '<button type="button" data-act="close">Cancel</button>' +
        '<button type="button" class="primary" id="btn-lb-save" title="Save the ticked activities as a new library file; the app\'s own library file is offered first">Save library...</button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(backdrop);
  const $b = (sel) => backdrop.querySelector(sel);
  const listEl = $b("#lb-list"), readEl = $b("#lb-read"), errEl = $b("#lb-error"), countEl = $b("#lb-count");
  $b("#lb-intro").textContent = _intro(base);

  const close = () => backdrop.remove();
  for (const b of backdrop.querySelectorAll('[data-act="close"]')) b.addEventListener("click", close);

  /* The rows with what the owner set on them. */
  const current = () => rows.map((r) => Object.assign({}, r, edits.get(r.key) || {}));
  const edit = (key, field, value) => {
    const e = edits.get(key) || {};
    e[field] = value;
    edits.set(key, e);
  };
  const drawCount = () => {
    const now = current();
    countEl.textContent = "Ticked: " + now.filter((r) => r.ticked).length + " of " + now.length;
  };
  const drawRead = () => {
    const names = sources.map((s) => s.name);
    const read = names.length ? "Read " + _plural(names.length, "project", "projects") + ": " + names.join(", ") + "." : "No project read yet.";
    const left = noSystem ? " " + _plural(noSystem, "named step has", "named steps have") + " no system and " +
      (noSystem === 1 ? "is" : "are") + " left out: the library lists activities by system." : "";
    readEl.textContent = read + left + (lastRead ? " " + lastRead : "");
    readEl.classList.toggle("lb-bad", /Not read/.test(lastRead));
  };
  const draw = () => {
    listEl.innerHTML = _listHtml(current());
    drawRead();
    drawCount();
  };
  const rebuild = () => {
    const c = Builder.collect(sources);
    noSystem = c.noSystem;
    rows = Builder.rows(base.library, c.entries);
    draw();
  };

  // The owner's ticks and texts, kept by row across a rebuild.
  listEl.addEventListener("input", (e) => {
    const row = e.target.closest && e.target.closest(".lb-row");
    if (!row) return;
    const key = row.dataset.key;
    const t = e.target;
    if (t.classList.contains("lb-tick")) edit(key, "ticked", t.checked);
    else if (t.classList.contains("lb-name")) edit(key, "name", t.value);
    else if (t.classList.contains("lb-code")) edit(key, "code", t.value);
    else if (t.classList.contains("lb-desc")) edit(key, "description", t.value);
    errEl.textContent = "";
    drawCount();
  });
  listEl.addEventListener("change", (e) => {
    const row = e.target.closest && e.target.closest(".lb-row");
    if (row && e.target.classList.contains("lb-tick")) { edit(row.dataset.key, "ticked", e.target.checked); drawCount(); }
  });

  const add = async (kind) => {
    let r;
    try { r = kind === "zips" ? await Ipc.libraryAddZips() : await Ipc.libraryAddProjects(); }
    catch (e) { r = { sources: [], failed: [{ path: "", error: (e && e.message) || String(e) }] }; }
    if (!r || !backdrop.isConnected) return;   // the dialog was cancelled, or this one closed
    const added = (r.sources || []).map((s) => Object.assign(s, { name: _sourceName(s) }));
    const merged = Builder.mergeSources(sources, added);
    sources = merged.sources;
    const failed = r.failed || [];
    lastRead = (merged.replaced ? "The same project added again replaced its earlier copy." : "") +
      (failed.length ? (merged.replaced ? " " : "") + "Not read: " + failed.map((f) => (f.path ? f.path.split(/[\\/]/).pop() + " (" : "(") + f.error + ")").join("; ") + "." : "");
    rebuild();
  };
  $b("#btn-lb-add-projects").addEventListener("click", () => add("projects"));
  $b("#btn-lb-add-zips").addEventListener("click", () => add("zips"));

  $b("#btn-lb-save").addEventListener("click", async () => {
    // A ticked row without a name would drop out of the library unnoticed.
    if (current().some((r) => r.ticked && !String(r.name || "").trim())) {
      errEl.textContent = "A ticked row has no name: name it or untick it.";
      return;
    }
    const doc = Builder.buildLibrary(base.library, current(), Builder.nextVersion(base.library.version));
    const bad = Library.problems(doc);
    if (bad.length) { errEl.textContent = "The library cannot be saved: " + bad[0] + "."; return; }
    errEl.textContent = "";
    let r;
    try { r = await Ipc.saveLibrary({ library: doc }); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (!r || r.cancelled) return;
    if (!r.ok) { errEl.textContent = r.error || "The library was not saved."; return; }
    close();
    const c = Library.counts(doc);
    toast("Saved Library " + doc.version + " (" + _plural(c.applications, "application", "applications") + ", " +
      _plural(c.activities, "activity", "activities") + ") to " + r.path + ".", "success");
    if (typeof o.onSaved === "function") o.onSaved({ path: r.path, library: doc });
  });

  rebuild();
}

module.exports = { openLibraryBuilder };
