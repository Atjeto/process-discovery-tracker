/*
 * ipc.js -- typed wrappers over the renderer <-> main IPC surface.
 *
 * Every viewer:* channel gets one named function here; callers go
 * through these instead of touching ipcRenderer directly, so the whole
 * IPC surface is visible and auditable in one place. Replaces the
 * informal, scattered ipcRenderer.invoke(...) calls (ADR-0003 / S7).
 */

"use strict";

const { ipcRenderer } = require("electron");

/* ---- Session loading ---- */

/** @param {string} folder @returns {Promise<any>} */
function loadSession(folder) {
  return ipcRenderer.invoke("viewer:loadSession", folder);
}

/** @returns {Promise<any>} chosen session folder path, or null */
function openSessionFolder() {
  return ipcRenderer.invoke("viewer:openSessionFolder");
}

/** 2.0.1: a fresh copy of the demo project. @returns {Promise<any>} { ok, folder | error } */
function openDemo() {
  return ipcRenderer.invoke("viewer:openDemo");
}

/** Lane B4a: Open a zip... The zip `zipPath` (a drop), or the one picked in
 *  its dialog: a hand-off to open read only, or a project zip unzipped where
 *  the analyst says.
 *  @param {string} [zipPath]
 *  @returns {Promise<null|{ok: boolean, kind?: string, path?: string, error?: string, cancelled?: boolean}>} null when a dialog was cancelled */
function openZip(zipPath) {
  return ipcRenderer.invoke("viewer:openZip", { zipPath: zipPath || null });
}

/** Lane B4a: Cancel on the unzipping's status line. */
function cancelUnzip() {
  return ipcRenderer.invoke("viewer:cancelUnzip");
}

/* The renderer's flow behind Open a zip... (renderer.js sets it: the status
   line, the sentences, and what then opens). */
let _zipFlow = null;
function setZipFlow(fn) { _zipFlow = typeof fn === "function" ? fn : null; }

/** Open, Open a zip... (the menu item and the start page's button keep lane
 *  HV's handles, flow-view.js openHandoffFlow, which loads what this gives):
 *  the path to open (a hand-off zip, or the folder a project zip was
 *  unzipped to), or null.
 *  @returns {Promise<string|null>} */
async function openHandoffDialog() {
  if (_zipFlow) return _zipFlow();
  const r = await openZip();
  return r && r.ok ? r.path : null;
}

/** Lane MW: open the project folder `folder` in a new window.
 *  @param {string} folder
 *  @returns {Promise<{ok: boolean, folder?: string, error?: string}>} */
function openInNewWindow(folder) {
  return ipcRenderer.invoke("viewer:openInNewWindow", { folder });
}

/* ---- Normalization ---- */

/** @param {object} opts @returns {Promise<any>} */
function runNormalizeExtended(opts) {
  return ipcRenderer.invoke("viewer:runNormalizeExtended", opts);
}

/** @returns {Promise<any>} */
function cancelNormalize() {
  return ipcRenderer.invoke("viewer:cancelNormalize");
}

/* ---- Annotations ---- */

/** @param {object} payload @returns {Promise<any>} */
function saveAnnotations(payload) {
  return ipcRenderer.invoke("viewer:saveAnnotations", payload);
}

/** The unreadable banner's Restore the newest backup.
 *  @param {{sessionFolder: string, expect: string}} payload
 *  @returns {Promise<{ok: boolean, backup?: string, mtimeMs?: number, keptAs?: string, error?: string}>} */
function restoreAnnotationsBackup(payload) {
  return ipcRenderer.invoke("viewer:restoreAnnotationsBackup", payload);
}

/* ---- The activity library (C21) ---- */

/** The app's library, read (library.js readLibraryFile).
 *  @returns {Promise<{status: string, path: string, library: object, error: (string|null)}>} */
function readAppLibrary() {
  return ipcRenderer.invoke("viewer:readAppLibrary");
}

/** The Library builder's Add projects... and Add hand-off zips...: null when
 *  the dialog was cancelled, else { sources: [{ path, sessionId, manifest,
 *  annotations }], failed: [{ path, error }] }.
 *  @returns {Promise<any>} */
function libraryAddProjects() {
  return ipcRenderer.invoke("viewer:libraryAddProjects");
}

/** @returns {Promise<any>} */
function libraryAddZips() {
  return ipcRenderer.invoke("viewer:libraryAddZips");
}

/** Save library...: { ok: true, path }, { ok: false, cancelled: true } or
 *  { ok: false, error }.
 *  @param {{library: object}} payload
 *  @returns {Promise<any>} */
function saveLibrary(payload) {
  return ipcRenderer.invoke("viewer:saveLibrary", payload);
}

/* ---- Export / shell ---- */

/** @param {object} payload @returns {Promise<any>} */
function exportFile(payload) {
  return ipcRenderer.invoke("viewer:exportFile", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function saveSvgFile(payload) {
  return ipcRenderer.invoke("viewer:saveSvgFile", payload);
}

/** @param {string} filePath @returns {Promise<any>} */
function revealFile(filePath) {
  return ipcRenderer.invoke("viewer:revealFile", filePath);
}

/** @param {string} filePath @returns {Promise<any>} */
function openExternal(filePath) {
  return ipcRenderer.invoke("viewer:openExternal", filePath);
}

/** Export, Whole project (.zip): the project folder as "<name>.zip" next to it.
 *  @param {{sessionFolder: string}} payload
 *  @returns {Promise<{ok: boolean, path?: string, bytes?: number, size?: string, entries?: number, error?: string}>} */
function exportProjectZip(payload) {
  return ipcRenderer.invoke("viewer:exportProjectZip", payload);
}

/** 2.0.1: the PDD with its attachments, one zip where the analyst saves it.
 *  @param {{sessionFolder: string, pdd: string, name: string}} payload
 *  @returns {Promise<{ok: boolean, path?: string, files?: number, error?: string}|null>} */
function exportPddZip(payload) {
  return ipcRenderer.invoke("viewer:exportPddZip", payload);
}

/** Lane HV (contract C20): the hand-off's zip next to the project folder.
 *  @param {{sessionFolder: string, base: string, version: number, pdd: string, tech: string}} payload
 *  @returns {Promise<{ok: boolean, path?: string, size?: string, error?: string}>} */
function exportHandoffZip(payload) {
  return ipcRenderer.invoke("viewer:exportHandoffZip", payload);
}

/** Lane HV: open the PDD ("pdd") or the Technical details ("tech") a
 *  hand-off opened read only came with.
 *  @param {{sessionFolder: string, kind: string}} payload
 *  @returns {Promise<{ok: boolean, path?: string, error?: string}>} */
function openHandoffFile(payload) {
  return ipcRenderer.invoke("viewer:openHandoffFile", payload);
}

/* ---- External video ---- */

/** @param {object} payload @returns {Promise<any>} */
function attachExternalVideo(payload) {
  return ipcRenderer.invoke("viewer:attachExternalVideo", payload);
}

/** Keep the video the project plays in its folder (copied into video/ when
 *  it is outside it); the renderer then writes annotations.external_videos
 *  (contract C23).
 *  @param {{sessionFolder: string, videoPath: string}} payload
 *  @returns {Promise<{ok: boolean, stored?: string, copied?: boolean, copyError?: string|null, error?: string}>} */
function copyVideoIn(payload) {
  return ipcRenderer.invoke("viewer:copyVideoIn", payload);
}

/* ---- Meeting transcript (C8) ---- */

/** Attach or replace the transcript (an open dialog, then the import).
 *  @param {{sessionFolder: string}} payload
 *  @returns {Promise<null|{ok: boolean, summary?: string, code?: number|null, error?: string}>} null when cancelled */
function importTranscript(payload) {
  return ipcRenderer.invoke("viewer:importTranscript", payload);
}

/** Remove the transcript: transcript.json and its originals, parked for an Undo.
 *  @param {{sessionFolder: string}} payload
 *  @returns {Promise<{ok: boolean, removed?: boolean, tag?: string, files?: string[], error?: string}>} */
function removeTranscript(payload) {
  return ipcRenderer.invoke("viewer:removeTranscript", payload);
}

/** Undo of Remove transcript: its parked files come back.
 *  @param {{sessionFolder: string, tag: string, files: string[]}} payload
 *  @returns {Promise<{ok: boolean, restored?: string[], kept?: string[], error?: string}>} */
function restoreTranscript(payload) {
  return ipcRenderer.invoke("viewer:restoreTranscript", payload);
}

/** Save the transcript's sync offset.
 *  @param {{sessionFolder: string, offsetMs: number}} payload
 *  @returns {Promise<{ok: boolean, error?: string}>} */
function saveTranscriptSync(payload) {
  return ipcRenderer.invoke("viewer:saveTranscriptSync", payload);
}

/* ---- Projects without a recording, and what the analyst adds (C16) ---- */

/** Choose a new project: the video (kind "video"), then its name and folder.
 *  @param {{kind: "video"|"blank"}} payload
 *  @returns {Promise<null|{ok: boolean, name?: string, folder?: string, error?: string}>} null when cancelled */
function chooseNewProject(payload) {
  return ipcRenderer.invoke("viewer:chooseNewProject", payload);
}

/* Lane B4b: what a new project from videos says once it is made, beside
   flow-view.js's own message (renderer.js sets it: a transcript not
   attached). */
let _onNewProjectNotes = null;
function onNewProjectNotes(fn) { _onNewProjectNotes = typeof fn === "function" ? fn : null; }

/** Make the project chosen last. Lane B4b: its videos are measured here
 *  first (a chain needs their lengths, which only the page can read:
 *  flow-view-video.js probeLength), and the result's notes (a transcript
 *  not attached) go to onNewProjectNotes.
 *  @returns {Promise<{ok: boolean, folder?: string, notes?: string[], error?: string}>} */
async function createProject() {
  const videos = await ipcRenderer.invoke("viewer:newProjectVideos");
  let lengths = [];
  if (Array.isArray(videos) && videos.length) {
    const { probeLength } = require("./views/flow-view-video.js");
    lengths = await Promise.all(videos.map((v) => probeLength(v).catch(() => null)));
  }
  const r = await ipcRenderer.invoke("viewer:createProject", { lengths });
  if (r && r.ok && Array.isArray(r.notes) && r.notes.length && _onNewProjectNotes) _onNewProjectNotes(r);
  return r;
}

/** Lane B4a: an unzipping's progress, for the status line: { phase: "start",
 *  zip, folder }, { phase: "progress", done, total }, { phase: "end" }.
 *  @param {Function} fn */
function onUnzip(fn) {
  ipcRenderer.on("viewer:unzip", (_e, evt) => fn(evt));
}

/** Add a screenshot (source "file" asks for it; "video_frame" and "paste" pass `data`, base64).
 *  @param {{sessionFolder: string, source: string, data?: string}} payload
 *  @returns {Promise<null|{ok: boolean, id?: string, file?: string, error?: string}>} null when cancelled */
function addScreenshot(payload) {
  return ipcRenderer.invoke("viewer:addScreenshot", payload);
}

/** Attach a file (an open dialog, then a copy into attachments/).
 *  @param {{sessionFolder: string}} payload
 *  @returns {Promise<null|{ok: boolean, file?: string, label?: string, error?: string}>} null when cancelled */
function addAttachment(payload) {
  return ipcRenderer.invoke("viewer:addAttachment", payload);
}

/** Open an attachment (or show it in its folder).
 *  @param {{sessionFolder: string, file: string}} payload
 *  @returns {Promise<{ok: boolean, shown?: boolean, error?: string}>} */
function openAttachment(payload) {
  return ipcRenderer.invoke("viewer:openAttachment", payload);
}

/* ---- Main -> renderer subscriptions ---- */

/** @param {Function} fn called with each streamed normalization log line */
function onNormalizeLog(fn) {
  ipcRenderer.on("viewer:normalizeLog", (_e, text) => fn(text));
}

/** @param {Function} fn called with the session folder to open at startup */
function onOpenInitialSession(fn) {
  ipcRenderer.on("viewer:openInitialSession", (_e, folder) => fn(folder));
}

/** @param {Function} fn called with each write of a project folder, for the
 *  save state: { folder, channel, phase: "start" } then { folder, channel,
 *  phase: "end", ok, error, code } */
function onProjectWrite(fn) {
  ipcRenderer.on("viewer:projectWrite", (_e, evt) => fn(evt));
}

module.exports = {
  loadSession, openSessionFolder, openHandoffDialog, openInNewWindow, openDemo,
  openZip, cancelUnzip, setZipFlow, onUnzip, onNewProjectNotes,
  runNormalizeExtended, cancelNormalize,
  saveAnnotations, restoreAnnotationsBackup,
  readAppLibrary, libraryAddProjects, libraryAddZips, saveLibrary,
  exportFile, saveSvgFile, revealFile, openExternal, exportProjectZip, exportPddZip, exportHandoffZip, openHandoffFile,
  attachExternalVideo, copyVideoIn,
  importTranscript, removeTranscript, restoreTranscript, saveTranscriptSync,
  chooseNewProject, createProject, addScreenshot, addAttachment, openAttachment,
  onNormalizeLog, onOpenInitialSession, onProjectWrite,
};
