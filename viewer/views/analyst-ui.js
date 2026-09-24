/*
 * analyst-ui.js: what the analyst adds to a session, on screen (contract C16;
 * the owner: "This just adds more context at one place"). In the step pane:
 * the System field, the screenshots (Add screenshot from a frame of the
 * video, a pasted image or a file; Use in PDD; Remove), the notes and the
 * attachments. On the Overview: the Attachments list. On the Timeline: a
 * note at a moment (views/flow-view-timeline.js draws the Notes lane).
 *
 * Every change is one undoable edit (session.persistAnnotations). The main
 * process writes the files inside the session folder (analyst-files.js) and
 * moves a removed one out of it, and back when Undo names it again.
 * The pure rules are in analyst-content.js.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const { persistAnnotations, ensureAnnoShape } = require("../session.js");
const { escapeHtml, escapeAttr, toast, placeMenu, cryptoRandomId, recordingStartMs, sinceStart } = require("../dom.js");
const { promptModal } = require("../modals.js");
const AC = require("../analyst-content.js");
const SPM = require("../sub-process-maps.js");
const SystemNames = require("../system-names.js");
// Lazy: the Overview's unit tests load this module without a page.
const Video = () => require("./flow-view-video.js");

const NOT_PRINTED = "Notes stay in the app: the PDD does not print them.";

function _sess() { return State.getSession(); }
function _anno() { return ensureAnnoShape(_sess().annotations); }
function _list(anno, key) {
  if (!Array.isArray(anno[key])) anno[key] = [];
  return anno[key];
}
/* A step by id at any level (C19: a sub-step has its own screenshots, notes
   and attachments). */
function _step(anno, id) {
  const hit = SPM.findStep((anno && anno.steps) || [], id);
  return hit ? hit.step : null;
}
function _now() { return new Date().toISOString(); }

/* One undoable edit; a failed save has already been shown (session.js). */
async function _save(anno, label) {
  try { await persistAnnotations(anno, label); return true; } catch (_) { return false; }
}

/* A session-relative file as a file:// URL, or "" when it is not in the folder. */
function fileUrl(rel) {
  const s = _sess();
  if (!s || !s.sessionFolder || typeof rel !== "string" || !rel) return "";
  const base = path.resolve(s.sessionFolder), full = path.resolve(base, rel);
  const r = path.relative(base, full);
  if (!r || r.startsWith("..") || path.isAbsolute(r) || !fs.existsSync(full)) return "";
  return "file:///" + full.replace(/\\/g, "/");
}

/* The screenshots a step shows, ready to draw: [{ kind, ref, rel, url, time }]
   (time: since the recording started). */
function shotsOf(step) {
  const s = _sess();
  if (!s || !step) return [];
  const origin = recordingStartMs(s);
  const takenAt = {};
  for (const ev of s.events || []) if (ev && ev.type === "system" && ev.data && ev.data.path) takenAt[ev.data.path] = ev.timestamp;
  return AC.stepShots(step, (s.annotations || {}).analyst_screenshots).map((sh) => Object.assign({}, sh, {
    url: fileUrl(sh.rel), time: sinceStart(sh.at || takenAt[sh.rel], origin),
  })).filter((sh) => sh.url);
}

/* The notes a step shows (its own, and those at a moment inside it). */
function notesOf(step) {
  const s = _sess();
  return AC.notesForStep(((s && s.annotations) || {}).analyst_notes, step);
}

/* ---- The step pane ----------------------------------------------------------- */

/* The systems this session's steps are in (the one vocabulary, C14, and the
   systems set by hand). */
function _sessionSystems() {
  const s = _sess();
  const inter = {};
  for (const ev of (s && s.events) || []) if (ev && ev.type === "interaction") inter[ev.event_id] = ev;
  const names = (s && s.stats && s.stats.meta && s.stats.meta.app_names) || {};
  return (((s && s.annotations) || {}).steps || []).map((st) => SystemNames.whereOfStep(st, inter, names).system);
}

/* The System field: pick a system of this session or the shared list, or
   type one. `derived` is the system the recording gives (its placeholder). */
function systemFieldHtml(step, derived) {
  const own = typeof step.system === "string" ? step.system : "";
  const choices = AC.systemChoices(_sessionSystems(), SystemNames.knownSystems());
  return '<label>System <input type="text" id="step-system" list="step-system-list" value="' + escapeAttr(own) + '"' +
    ' placeholder="' + escapeAttr(derived && !own ? derived : "Pick or type the system") + '"' +
    ' title="The system this step happens in. Saved when you press Enter or leave the field; empty gives back the recorded one."></label>' +
    '<datalist id="step-system-list">' + choices.map((c) => '<option value="' + escapeAttr(c) + '"></option>').join("") + "</datalist>";
}

function _sectHead(title, btnId, btnLabel, btnTitle, headTitle) {
  return '<div class="step-sect-head"' + (headTitle ? ' title="' + escapeAttr(headTitle) + '"' : "") + ">" +
    '<span class="step-sect-title">' + escapeHtml(title) + "</span>" +
    '<button type="button" class="link-btn" id="' + btnId + '" title="' + escapeAttr(btnTitle) + '">' + escapeHtml(btnLabel) + "</button></div>";
}

/* The step pane's Screenshots, Notes and Attachments. */
function stepExtrasHtml(step) {
  const s = _sess();
  const anno = (s && s.annotations) || {};
  const shots = shotsOf(step);
  const hidden = AC.hiddenShotCount(step);
  const origin = recordingStartMs(s);
  const shotHtml = shots.map((sh) => {
    const inPdd = step.pdd_screenshot === sh.ref;
    return '<div class="step-shot-card" data-ref="' + escapeAttr(sh.ref) + '" data-kind="' + sh.kind + '">' +
      '<button type="button" class="step-shot" data-ref="' + escapeAttr(sh.ref) + '" data-rel="' + escapeAttr(sh.rel) + '" title="' +
        escapeAttr((sh.time ? sh.time + ": " : "") + "open it full size") + '"><img src="' + escapeAttr(sh.url) + '" alt="' +
        escapeAttr("Screenshot" + (sh.time ? " at " + sh.time : "")) + '">' + (sh.time ? '<span class="stamp">' + escapeHtml(sh.time) + "</span>" : "") + "</button>" +
      '<div class="step-shot-acts">' +
        '<button type="button" class="link-btn' + (inPdd ? " on" : "") + '" data-shot-act="pdd" aria-pressed="' + inPdd + '" title="' +
          escapeAttr(inPdd ? "The PDD prints only this screenshot under the step. Click to print all of them again."
            : "Print only this screenshot under the step in the PDD") + '">' + (inPdd ? "In the PDD" : "Use in PDD") + "</button>" +
        '<button type="button" class="link-btn" data-shot-act="remove" title="' + escapeAttr(sh.kind === "analyst"
          ? "Remove this screenshot you added. Ctrl+Z brings it back." : "Take this screenshot off the step; the recording keeps it.") + '">Remove</button>' +
      "</div></div>";
  }).join("");
  const notes = notesOf(step).map((n) => '<li class="step-note" data-note-id="' + escapeAttr(n.id) + '">' +
    '<span class="step-note-text">' + escapeHtml(n.text) + "</span>" +
    (n.at ? '<span class="step-note-at">at ' + escapeHtml(sinceStart(n.at, origin)) + "</span>" : "") +
    '<button type="button" class="link-btn" data-note-act="edit">Edit</button>' +
    '<button type="button" class="link-btn" data-note-act="delete">Delete</button></li>').join("");
  const atts = ((anno.attachments) || []).filter((a) => a && a.step_id === step.step_id).map((a) =>
    '<li class="att-row" data-att-id="' + escapeAttr(a.id) + '"><span class="att-label" title="' + escapeAttr(a.file) + '">' +
    escapeHtml(a.label || a.file) + "</span>" +
    '<button type="button" class="link-btn" data-att-act="open">Open</button>' +
    '<button type="button" class="link-btn" data-att-act="remove">Remove</button></li>').join("");
  return '<div class="step-sect" id="step-shots-sect">' +
      _sectHead("Screenshots", "btn-step-add-shot", "Add screenshot ▾",
        "Add a screenshot to this step: a frame of the video, a pasted image (Ctrl+V in this pane) or a file") +
      (shotHtml ? '<div class="step-shots">' + shotHtml + "</div>" : "") +
      (hidden ? '<button type="button" class="link-btn step-unhide-shots" data-shot-act="unhide">Show hidden screenshots (' + hidden + ")</button>" : "") +
    "</div>" +
    '<div class="step-sect" id="step-notes-sect">' +
      _sectHead("Notes", "btn-step-add-note", "Add note", "Add a note to this step", NOT_PRINTED) +
      (notes ? '<ul class="step-notes">' + notes + "</ul>" : "") +
    "</div>" +
    '<div class="step-sect" id="step-atts-sect">' +
      _sectHead("Attachments", "btn-step-attach", "Attach file...",
        "Attach a file to this step (an example email, a form, a spreadsheet). It is copied into the project folder and listed in the PDD.") +
      (atts ? '<ul class="att-list">' + atts + "</ul>" : "") +
    "</div>";
}

/* Wire the System field of the step pane just drawn (`isRendering`: the
   pane is being drawn again, so a blur then saves nothing). */
function wireStepPane(host, step, isRendering) {
  const sys = host.querySelector("#step-system");
  if (!sys) return;
  const commit = () => {
    if ((isRendering && isRendering()) || !sys.isConnected) return;
    setSystem(step.step_id, sys.value);
  };
  sys.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); sys.value = step.system || ""; }
  });
  sys.addEventListener("blur", commit);
}

/* The three sections' clicks, delegated once: they act on the step the pane
   shows (the selected step). */
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
  const pane = document.getElementById("step-detail");
  const t = e.target && e.target.closest ? e.target : null;
  const stepId = State.getSelectedStepId();
  if (!pane || !t || !pane.contains(t) || !stepId || !_sess()) return;
  const card = t.closest(".step-shot-card");
  const shotAct = t.closest("[data-shot-act]");
  if (shotAct) {
    const act = shotAct.dataset.shotAct;
    if (act === "unhide") showHiddenShots(stepId);
    else if (card && act === "pdd") togglePdd(stepId, card.dataset.ref);
    else if (card && act === "remove") removeShot(stepId, card.dataset.kind, card.dataset.ref);
  } else if (card && t.closest(".step-shot")) {
    require("./flow-view-screenshots.js").openScreenshot(t.closest(".step-shot").dataset.rel);
  } else if (t.closest("#btn-step-add-shot")) {
    _shotMenu(t.closest("#btn-step-add-shot"), stepId);
  } else if (t.closest("#btn-step-add-note")) {
    addNote(stepId, null);
  } else if (t.closest("[data-note-act]")) {
    const id = t.closest(".step-note").dataset.noteId;
    if (t.closest("[data-note-act]").dataset.noteAct === "edit") editNote(id); else deleteNote(id);
  } else if (t.closest("#btn-step-attach")) {
    attachFile(stepId);
  } else if (t.closest("#step-atts-sect [data-att-act]")) {
    const id = t.closest("[data-att-id]").dataset.attId;
    if (t.closest("[data-att-act]").dataset.attAct === "open") openAttachment(id); else removeAttachment(id);
  }
});

/* The System field's save: step.system, or none (the recorded one). */
async function setSystem(stepId, value) {
  const anno = _anno();
  const st = _step(anno, stepId);
  const v = String(value || "").trim();
  if (!st || v === (typeof st.system === "string" ? st.system.trim() : "")) return;
  if (v) st.system = v; else delete st.system;
  AC.markEdited(st);
  if (await _save(anno, "set the step's system")) toast(v ? "System: " + v + "." : "The recorded system again.", "success");
}

/* ---- Screenshots ------------------------------------------------------------- */

/* The video a frame is taken from: the step panel's while it shows one, else
   the Timeline's. */
function _frameVideo() {
  const panel = document.getElementById("step-panel");
  const sp = document.getElementById("sp-video");
  if (panel && !panel.hidden && sp && !sp.hidden && sp.getAttribute("src")) return sp;
  const v = document.getElementById("video");
  return v && v.getAttribute("src") && _sess() && _sess().recordingAvailable ? v : null;
}

/* The video's current frame as a base64 PNG, or null. */
async function _grabFrame(video) {
  if (video.readyState < 2) {
    await new Promise((res) => {
      const done = () => res();
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("loadeddata", done, { once: true });
      setTimeout(done, 4000);
      video.currentTime = video.currentTime || 0;
    });
  }
  if (!video.videoWidth || !video.videoHeight) return null;
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/png");
  const i = url.indexOf("base64,");
  return i >= 0 ? url.slice(i + 7) : null;
}

/* Add a screenshot to a step from `source`: "video_frame", "paste" (with
   `data`, a base64 image, or the clipboard's image) or "file". */
async function addScreenshot(stepId, source, data) {
  const s = _sess();
  if (!s || !stepId) return;
  let at = null;
  if (source === "video_frame") {
    const v = _frameVideo();
    if (!v) { toast("There is no video to take a frame from.", "error"); return; }
    data = await _grabFrame(v);
    if (!data) { toast("The video frame could not be read.", "error"); return; }
    at = Video().videoTimeToSessionTs(v.currentTime);
  } else if (source === "paste" && !data) {
    const img = require("electron").clipboard.readImage();
    if (img.isEmpty()) { toast("The clipboard holds no image. Copy one first, or press Ctrl+V in this pane.", "error"); return; }
    data = img.toPNG().toString("base64");
  }
  let r;
  try { r = await Ipc.addScreenshot({ sessionFolder: s.sessionFolder, source, data }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r) return;   // the file dialog was cancelled
  if (!r.ok) { toast("The screenshot was not added: " + (r.error || "no reason was given"), "error"); return; }
  if (_sess() !== s) return;
  const anno = _anno();
  _list(anno, "analyst_screenshots").push({ id: r.id, file: r.file, step_id: stepId, at, source, added_at: _now() });
  const st = _step(anno, stepId);
  if (st) AC.markEdited(st);
  if (await _save(anno, "add a screenshot")) toast("Screenshot added. Ctrl+Z takes it back.", "success");
}

function _shotMenu(btn, stepId) {
  const prior = document.getElementById("shot-src-menu");
  if (prior) { prior.remove(); return; }
  const menu = document.createElement("div");
  menu.id = "shot-src-menu";
  menu.className = "project-menu-popup shot-src-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = (_frameVideo() ? '<button type="button" class="project-menu-item" data-src="video_frame">A frame of the video</button>' : "") +
    '<button type="button" class="project-menu-item" data-src="paste" title="Or press Ctrl+V in the step pane">Paste an image</button>' +
    '<button type="button" class="project-menu-item" data-src="file">From a file...</button>';
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  placeMenu(menu, r.left, r.bottom + 2);
  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", dismiss, true);
    document.removeEventListener("keydown", dismiss, true);
  };
  const dismiss = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "mousedown" && (menu.contains(e.target) || btn.contains(e.target))) return;
    close();
  };
  menu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-src]");
    if (!item) return;
    close();
    addScreenshot(stepId, item.dataset.src);
  });
  setTimeout(() => {
    document.addEventListener("mousedown", dismiss, true);
    document.addEventListener("keydown", dismiss, true);
  }, 0);
}

/* Use in PDD, and its inverse: the PDD prints this one screenshot under the
   step (step.pdd_screenshot), or every one again. */
async function togglePdd(stepId, ref) {
  const anno = _anno();
  const st = _step(anno, stepId);
  if (!st || !ref) return;
  const on = st.pdd_screenshot !== ref;
  if (on) st.pdd_screenshot = ref; else delete st.pdd_screenshot;
  AC.markEdited(st);
  if (await _save(anno, on ? "use a screenshot in the PDD" : "print every screenshot of the step")) {
    toast(on ? "The PDD prints this screenshot under the step." : "The PDD prints every screenshot of the step again.", "success");
  }
}

/* Remove: a screenshot the analyst added goes (entry and file); a recorder
   screenshot is taken off the step (hidden_screenshots), its file stays. */
async function removeShot(stepId, kind, ref) {
  const anno = _anno();
  const st = _step(anno, stepId);
  if (kind === "analyst") {
    anno.analyst_screenshots = _list(anno, "analyst_screenshots").filter((a) => a && a.id !== ref);
  } else if (st) {
    st.hidden_screenshots = [...new Set([...(Array.isArray(st.hidden_screenshots) ? st.hidden_screenshots : []), ref])];
    AC.markEdited(st);
  }
  if (st && st.pdd_screenshot === ref) { delete st.pdd_screenshot; AC.markEdited(st); }
  if (await _save(anno, "remove a screenshot")) {
    toast(kind === "analyst" ? "Screenshot removed. Ctrl+Z brings it back."
      : "Screenshot taken off the step; the recording keeps it. Ctrl+Z brings it back.", "success");
  }
}

async function showHiddenShots(stepId) {
  const anno = _anno();
  const st = _step(anno, stepId);
  if (!st || !Array.isArray(st.hidden_screenshots)) return;
  delete st.hidden_screenshots;
  if (await _save(anno, "show hidden screenshots")) toast("The hidden screenshots are back on the step.", "success");
}

/* Ctrl+V in the step pane: an image on the clipboard becomes a screenshot of
   the selected step (text pasted into a field stays text). */
if (typeof document !== "undefined") document.addEventListener("paste", (e) => {
  const pane = document.getElementById("step-detail");
  const active = document.activeElement;
  if (!pane || !_sess() || State.getLevel() !== "steps" || !active || !(active === pane || pane.contains(active))) return;
  const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
  const img = items.find((i) => i.kind === "file" && /^image\/(png|jpeg)$/.test(i.type));
  const stepId = State.getSelectedStepId();
  if (!img || !stepId) return;
  if ((active.tagName === "INPUT" || active.tagName === "TEXTAREA") && items.some((i) => i.type === "text/plain")) return;
  e.preventDefault();
  const file = img.getAsFile();
  if (file) file.arrayBuffer().then((ab) => addScreenshot(stepId, "paste", Buffer.from(ab).toString("base64")));
});

/* ---- Notes (annotations.analyst_notes; never printed) ------------------------ */

/* Add a note to a step, or (stepId null) at the moment `at`. */
async function addNote(stepId, at) {
  if (!_sess()) return;
  const text = await promptModal({ title: "Add note", message: stepId ? "A note on this step" : "A note at this moment",
    detail: NOT_PRINTED, multiline: true, okLabel: "Add note" });
  if (text == null || !String(text).trim() || !_sess()) return;
  const anno = _anno();
  _list(anno, "analyst_notes").push({ id: cryptoRandomId(), text: String(text).trim(), step_id: stepId || null,
    at: stepId ? null : at, added_at: _now() });
  const st = stepId && _step(anno, stepId);
  if (st) AC.markEdited(st);
  if (!stepId) {
    const Timeline = require("./flow-view-timeline.js");
    Timeline.setLaneToggle("notes", true);
    const cb = document.querySelector('#lanes-popup input[data-lane="notes"]');
    if (cb) cb.checked = true;
  }
  if (await _save(anno, "add a note")) toast("Note added. Ctrl+Z takes it back.", "success");
}

async function editNote(id) {
  const anno = _anno();
  const n = _list(anno, "analyst_notes").find((x) => x && x.id === id);
  if (!n) return;
  const text = await promptModal({ title: "Edit note", detail: NOT_PRINTED, multiline: true, defaultValue: n.text, okLabel: "Save" });
  if (text == null || !String(text).trim() || String(text).trim() === n.text) return;
  n.text = String(text).trim();
  if (await _save(anno, "edit a note")) toast("Note saved.", "success");
}

async function deleteNote(id) {
  const anno = _anno();
  anno.analyst_notes = _list(anno, "analyst_notes").filter((x) => x && x.id !== id);
  if (await _save(anno, "delete a note")) toast("Note deleted. Ctrl+Z brings it back.", "success");
}

/* ---- Attachments --------------------------------------------------------------- */

/* Attach a file to the session, or to a step. */
async function attachFile(stepId) {
  const s = _sess();
  if (!s) return;
  let r;
  try { r = await Ipc.addAttachment({ sessionFolder: s.sessionFolder }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r) return;
  if (!r.ok) { toast("The file was not attached: " + (r.error || "no reason was given"), "error"); return; }
  if (_sess() !== s) return;
  const anno = _anno();
  _list(anno, "attachments").push({ id: cryptoRandomId(), file: r.file, label: r.label || r.file, step_id: stepId || null, added_at: _now() });
  const st = stepId && _step(anno, stepId);
  if (st) AC.markEdited(st);
  if (await _save(anno, "attach a file")) toast("Attached: " + (r.label || r.file) + ". Ctrl+Z takes it back.", "success");
}

async function openAttachment(id) {
  const s = _sess();
  const a = s && ((s.annotations || {}).attachments || []).find((x) => x && x.id === id);
  if (!a) return;
  let r;
  try { r = await Ipc.openAttachment({ sessionFolder: s.sessionFolder, file: a.file }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) toast("The file could not be opened: " + ((r && r.error) || "no reason was given"), "error");
  else if (r.shown) toast("This kind of file is not opened from the app: it is shown in its folder.", "info");
}

async function removeAttachment(id) {
  const anno = _anno();
  anno.attachments = _list(anno, "attachments").filter((x) => x && x.id !== id);
  if (await _save(anno, "remove an attachment")) toast("Attachment removed. Ctrl+Z brings it back.", "success");
}

async function renameAttachment(id, label) {
  const anno = _anno();
  const a = _list(anno, "attachments").find((x) => x && x.id === id);
  const v = String(label || "").trim();
  if (!a || v === String(a.label || "").trim()) return;
  a.label = v;
  await _save(anno, "rename an attachment");
}

/* The Overview's Attachments list, under the document fields: every file
   attached to the session or to a step, its label editable. */
function overviewAttachmentsHtml(anno) {
  const a = anno || {};
  const rows = (Array.isArray(a.attachments) ? a.attachments : []).filter((x) => x && x.id).map((x) => {
    const st = x.step_id ? _step(a, x.step_id) : null;
    return '<li class="att-row" data-att-id="' + escapeAttr(x.id) + '">' +
      '<input type="text" class="att-label-input" value="' + escapeAttr(x.label || "") + '" placeholder="' + escapeAttr(x.file) +
        '" aria-label="Label" title="The label the PDD prints for this file">' +
      '<span class="att-file" title="' + escapeAttr(x.file) + '">' + escapeHtml(x.file) + "</span>" +
      (st ? '<span class="att-step" title="' + escapeAttr(st.name || "") + '">on ' + escapeHtml(st.name || "a step") + "</span>" : "") +
      '<button type="button" class="link-btn" data-att-act="open">Open</button>' +
      '<button type="button" class="link-btn" data-att-act="remove">Remove</button></li>';
  }).join("");
  return '<div class="ov-attach" id="ov-attach">' +
    '<div class="step-sect-head"><span class="ov-doc-label">Attachments</span>' +
      '<button type="button" class="link-btn" id="btn-ov-attach" title="Attach a file to this project (an example email, an input spreadsheet, an SOP). It is copied into the project folder and listed in the PDD.">Add file...</button></div>' +
    (rows ? '<ul class="att-list">' + rows + "</ul>" : '<p class="ov-attach-empty">No files attached. The PDD lists the files you attach here.</p>') +
    "</div>";
}

function wireOverviewAttachments(host) {
  const box = host && host.querySelector("#ov-attach");
  if (!box) return;
  box.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest("#btn-ov-attach")) { attachFile(null); return; }
    const act = t.closest("[data-att-act]");
    if (act) {
      const id = act.closest("[data-att-id]").dataset.attId;
      if (act.dataset.attAct === "open") openAttachment(id); else removeAttachment(id);
    }
  });
  box.querySelectorAll(".att-label-input").forEach((inp) => {
    inp.addEventListener("change", () => renameAttachment(inp.closest("[data-att-id]").dataset.attId, inp.value));
  });
}

module.exports = {
  fileUrl, shotsOf, notesOf, systemFieldHtml, stepExtrasHtml, wireStepPane, setSystem,
  addScreenshot, togglePdd, removeShot, addNote, editNote, deleteNote,
  attachFile, openAttachment, removeAttachment, overviewAttachmentsHtml, wireOverviewAttachments,
};
