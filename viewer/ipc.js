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

/* ---- Remembered names (C4) ---- */

/** Remember a step name for its draft key.
 *  @param {{draftKey: string, name: string}} payload
 *  @returns {Promise<{ok: boolean, path?: string, error?: string}>} */
function rememberStepName(payload) {
  return ipcRenderer.invoke("viewer:rememberStepName", payload);
}

/** The remembered names ({ ok, path, status, names } or { ok: false, error }).
 *  @returns {Promise<any>} */
function readRememberedNames() {
  return ipcRenderer.invoke("viewer:readRememberedNames");
}

/** Forget a remembered name.
 *  @param {{draftKey: string}} payload
 *  @returns {Promise<{ok: boolean, removed?: boolean, path?: string, error?: string}>} */
function forgetStepName(payload) {
  return ipcRenderer.invoke("viewer:forgetStepName", payload);
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

/* ---- External video ---- */

/** @param {object} payload @returns {Promise<any>} */
function attachExternalVideo(payload) {
  return ipcRenderer.invoke("viewer:attachExternalVideo", payload);
}

/** Keep the video the project plays in its folder (copied into video/ when
 *  it is outside it); the renderer then writes annotations.external_video.
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

/** Make the project chosen last.
 *  @returns {Promise<{ok: boolean, folder?: string, error?: string}>} */
function createProject() {
  return ipcRenderer.invoke("viewer:createProject");
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
  loadSession, openSessionFolder,
  runNormalizeExtended, cancelNormalize,
  saveAnnotations, restoreAnnotationsBackup,
  rememberStepName, readRememberedNames, forgetStepName,
  exportFile, saveSvgFile, revealFile, openExternal, exportProjectZip,
  attachExternalVideo, copyVideoIn,
  importTranscript, removeTranscript, restoreTranscript, saveTranscriptSync,
  chooseNewProject, createProject, addScreenshot, addAttachment, openAttachment,
  onNormalizeLog, onOpenInitialSession, onProjectWrite,
};
