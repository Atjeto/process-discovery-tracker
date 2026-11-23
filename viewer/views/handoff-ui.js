"use strict";

/*
 * handoff-ui.js: Export, Hand off... and the Export menu of a hand-off opened
 * read only (lane HV, contract C20). The pure rules are handoff.js; the zip
 * is main's (handoff-zip.js, viewer:exportHandoffZip).
 *
 * Hand off...:
 *   1. one small dialog: "What changed in this version?" (one line; the
 *      first hand-off's is filled with "First hand-off"); lane B-V2: above
 *      the note, what a reader of this version will miss (readiness.js),
 *      each line a link that cancels the hand-off and goes where it is
 *      fixed, and the button then reads Hand off anyway;
 *   2. the version entry goes into annotations.handoffs, { version,
 *      handed_off_at, by (the Windows user), note }: an undoable edit, so
 *      Ctrl+Z takes it back (the zip file stays where it is);
 *   3. the PDD and the Technical details of this version, by the PDD's own
 *      path (renderer.js writeDocuments: the analysis first when the step map
 *      is older than the steps, then one run with --handoff N); where nothing
 *      was recorded and no step lists information (C26) or an exception (C27)
 *      the pipeline writes
 *      no Technical details, and the zip goes out without them;
 *   4. the process map as a picture and as BPMN, by the two map exports'
 *      own paths (renderer.js writeHandoffMaps); none when no map can be
 *      drawn;
 *   5. "<project> v<N>.zip" next to the project folder, never over another
 *      zip, with Start here.txt at its root (handoff-zip.js), then its folder
 *      opens with the zip selected.
 * A hand-off that does not finish takes its version entry back at once
 * (session.js takeBackLastEdit), so no version is ever recorded without its
 * zip.
 *
 * In a hand-off opened read only, the Export menu opens the PDD and the
 * Technical details the zip came with (viewer:openHandoffFile).
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const Session = require("../session.js");
const Handoff = require("../handoff.js");
const RO = require("../read-only.js");
const AC = require("../analyst-content.js");
const StepInfo = require("../step-information.js");
const StepExc = require("../step-exceptions.js");
const Readiness = require("../readiness.js");
const { toast } = require("../dom.js");
const { promptModal } = require("../modals.js");

let _deps = { writeDocuments: null, writeMaps: null };
let _busy = false;

/* The Windows user who hands off: the login the app runs under. */
function _user() {
  try { return os.userInfo().username || ""; } catch (_) { return process.env.USERNAME || ""; }
}

const IDLE_LABEL = "Hand off...";

/* While a hand-off is made, Export pulses (as for the Whole project zip) and
   its item says so. */
function _setBusy(busy) {
  _busy = busy;
  const btn = document.getElementById("btn-session-export-menu");
  if (btn) {
    if (!btn.dataset.idleTitle) btn.dataset.idleTitle = btn.title;
    btn.classList.toggle("busy", busy);
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    btn.title = busy ? "Handing off: the zip's folder opens when it is ready" : btn.dataset.idleTitle;
  }
  const item = document.getElementById("btn-session-handoff");
  if (item) {
    item.disabled = busy;
    item.textContent = busy ? "Handing off..." : IDLE_LABEL;
  }
}

/* Take back a version entry the hand-off recorded and could not finish: the
   edit is undone at once when it is still the last one; else (the analyst
   changed something meanwhile) the entry leaves with an edit of its own. */
async function _takeBack(tag, entry) {
  if (await Session.takeBackLastEdit(tag)) return;
  const sess = State.getSession();
  const anno = sess && sess.annotations;
  if (!anno || !Array.isArray(anno.handoffs)) return;
  const i = anno.handoffs.findIndex((e) => e && e.version === entry.version && e.handed_off_at === entry.handed_off_at);
  if (i === -1) return;
  anno.handoffs.splice(i, 1);
  try { await Session.saveAnnotationsWithUndo(anno, "Take back version " + entry.version); }
  catch (_) { /* already shown to the analyst */ }
}

async function handOff() {
  const sess = State.getSession();
  if (!sess) { toast("Open a project first.", "error"); return; }
  if (RO.isReadOnly(sess) || sess.annotationsError || _busy) return;
  if (!_deps.writeDocuments) { toast("The hand-off is not available in this window.", "error"); return; }
  const anno = Session.ensureAnnoShape(sess.annotations);
  const version = Handoff.nextVersion(anno);
  const base = Handoff.projectName(sess);
  const names = Handoff.fileNames(base, version);
  // Lane B-V2: what a reader of this version will miss, each line leading to
  // where it is fixed (a click cancels the hand-off). Lazy require: the
  // Overview's module wires the DOM it renders into.
  const Overview = require("./overview-view.js");
  const missing = Overview.missingOf(sess);
  const note = await promptModal(dialogOptions({ version, zipName: names.zip, recording: holdsTechDetails(sess), missing,
    onPick: (entry) => Overview.goToMissing(entry) }));
  if (note === null || State.getSession() !== sess) return;
  _setBusy(true);
  const entry = Handoff.newEntry({ version, note, by: _user(), now: new Date().toISOString() });
  const tag = "handoff:" + entry.handed_off_at;
  const before = Array.isArray(anno.handoffs) ? anno.handoffs : null;
  anno.handoffs = (before || []).concat([entry]);
  let dir = null;
  try {
    try {
      // The entry changes no step, so a step map current before stays current.
      await require("../refmap-ui.js").keepingStepMapCurrent(() =>
        Session.saveAnnotationsWithUndo(anno, "Hand off version " + version + " (the zip file stays)", { tag }));
    } catch (_) {
      // Already shown to the analyst; no version without its zip.
      if (before) anno.handoffs = before; else delete anno.handoffs;
      return;
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-handoff-"));
    const pdd = path.join(dir, names.pdd);
    const tech = path.join(dir, names.tech);
    // 2.0.1: the PDD's attachment names link to the files in the project
    // folder the zip holds beside it.
    const atts = ((State.getSession().annotations || {}).attachments || []).some((a) => a && a.file);
    const made = await _deps.writeDocuments(State.getSession(), {
      pddOut: pdd, techOut: tech, handoff: version, label: "Handing off version " + version + "...",
      pddAttachments: atts ? path.basename(sess.sessionFolder) + "/attachments" : null,
    });
    if (!made.ok) {
      await _takeBack(tag, entry);
      toast("Version " + version + " was not handed off" + (made.message ? ": " + made.message : "."), "error");
      return;
    }
    // The map files: the hand-off goes out without them when no map can be drawn.
    const maps = _deps.writeMaps ? await _deps.writeMaps(State.getSession(), dir, names) : { mapSvg: null, mapBpmn: null };
    let r;
    try {
      r = await Ipc.exportHandoffZip({ sessionFolder: sess.sessionFolder, base, version, pdd,
        tech: made.techWritten === false ? null : tech, mapSvg: maps.mapSvg, mapBpmn: maps.mapBpmn });
    } catch (e) {
      r = { ok: false, error: (e && e.message) || String(e) };
    }
    if (!r || !r.ok) {
      await _takeBack(tag, entry);
      toast("Version " + version + " was not handed off: the zip was not made. " + ((r && r.error) || "No reason was given."), "error");
      return;
    }
    await Ipc.revealFile(r.path);
    toast("Handed off version " + version + ": " + path.basename(r.path) + " (" + r.size + "). " +
      "Ctrl+Z takes version " + version + " back; the zip file stays.", "success");
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } }
    _setBusy(false);
  }
}

/* A hand-off opened read only: the PDD or the Technical details it came
   with, opened in its program. */
async function openVersionFile(kind) {
  const sess = State.getSession();
  if (!sess || !RO.isReadOnly(sess)) return;
  let r;
  try { r = await Ipc.openHandoffFile({ sessionFolder: sess.sessionFolder, kind }); }
  catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
  if (!r || !r.ok) {
    toast("The " + (kind === "pdd" ? "PDD" : "Technical details") + " did not open: " + ((r && r.error) || "no reason was given"), "error");
  }
}

/* Whether the pipeline writes the project's Technical details: something was
   recorded, or (C26) a step lists information the analyst typed, or (C27)
   a step has an exception. Pure. */
function holdsTechDetails(sess) {
  const steps = ((sess && sess.annotations) || {}).steps;
  return AC.hasRecording(sess) || StepInfo.anyEntries(steps) || StepExc.anyEntries(steps);
}

/* The dialog's line on what the zip holds: the Technical details only where
   the pipeline writes them (`recording`: holdsTechDetails). */
function detailLine(zipName, version, recording) {
  return zipName + " is made next to the project folder: the whole project, with the PDD" +
    (recording ? ", the Technical details" : "") + " and the process map of version " + version + ".";
}

/* The most lines of what a reader will miss the dialog shows. */
const MISS_LINES = 6;

/* The Hand off... dialog's options (promptModal). With nothing missing it
   is the dialog it always was. With entries (readiness.js missing), the
   line "A reader of version N will miss:" and the entries' texts (at most
   six lines: with more, five and a last line "and N more"), each leading
   to where it is fixed through onPick(entry), and the button reads Hand
   off anyway. Pure. */
function dialogOptions({ version, zipName, recording, missing, onPick }) {
  const opts = {
    title: "Hand off version " + version,
    message: "What changed in this version?",
    detail: detailLine(zipName, version, recording),
    placeholder: "For example: the credit check added",
    defaultValue: version === 1 ? Handoff.FIRST_NOTE : "",
    okLabel: "Hand off",
    required: true,
  };
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return opts;
  const shown = list.length > MISS_LINES ? list.slice(0, MISS_LINES - 1) : list;
  opts.okLabel = "Hand off anyway";
  opts.list = {
    lead: Readiness.dialogLead(version),
    items: shown.map((e) => e.text),
    more: shown.length < list.length ? "and " + (list.length - shown.length) + " more" : "",
    onPick: (i) => { if (typeof onPick === "function" && shown[i]) onPick(shown[i]); },
  };
  return opts;
}

/* deps = { writeDocuments(target, { pddOut, techOut, handoff, label }),
   writeMaps(target, dir, names) } (renderer.js). Wires the Export menu's
   items once. */
function initHandoffUI(deps) {
  _deps = Object.assign({ writeDocuments: null, writeMaps: null }, deps || {});
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("btn-session-handoff", () => handOff());
  on("btn-handoff-open-pdd", () => openVersionFile("pdd"));
  on("btn-handoff-open-tech", () => openVersionFile("tech"));
}

module.exports = { initHandoffUI, handOff, openVersionFile, detailLine, dialogOptions, holdsTechDetails };
