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

/* ---- Saved processes (C5) ---- */

/** The saved processes ({ ok, path, status, processes } or { ok: false, error }).
 *  @returns {Promise<any>} */
function readProcesses() {
  return ipcRenderer.invoke("viewer:readProcesses");
}

/** "Save as this process".
 *  @param {{name: string, sourceSessionId: string, steps: object[]}} payload
 *  @returns {Promise<{ok: boolean, id?: string, previous?: object|null, path?: string, error?: string}>} */
function saveProcess(payload) {
  return ipcRenderer.invoke("viewer:saveProcess", payload);
}

/** Undo "Save as this process" (the replaced process comes back, or the new one goes).
 *  @param {{id: string, previous: object|null}} payload
 *  @returns {Promise<{ok: boolean, changed?: boolean, path?: string, error?: string}>} */
function undoSaveProcess(payload) {
  return ipcRenderer.invoke("viewer:undoSaveProcess", payload);
}

/** Forget a saved process (its inverse: undoSaveProcess with the removed entry).
 *  @param {{id: string}} payload
 *  @returns {Promise<{ok: boolean, removed?: object, path?: string, error?: string}>} */
function forgetProcess(payload) {
  return ipcRenderer.invoke("viewer:forgetProcess", payload);
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

/* ---- External video ---- */

/** @param {object} payload @returns {Promise<any>} */
function attachExternalVideo(payload) {
  return ipcRenderer.invoke("viewer:attachExternalVideo", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function saveExternalVideoSync(payload) {
  return ipcRenderer.invoke("viewer:saveExternalVideoSync", payload);
}

/* ---- Meeting transcript (C8) ---- */

/** Attach or replace the transcript (an open dialog, then the import).
 *  @param {{sessionFolder: string}} payload
 *  @returns {Promise<null|{ok: boolean, summary?: string, code?: number|null, error?: string}>} null when cancelled */
function importTranscript(payload) {
  return ipcRenderer.invoke("viewer:importTranscript", payload);
}

/** Remove the transcript (transcript.json only).
 *  @param {{sessionFolder: string}} payload
 *  @returns {Promise<{ok: boolean, removed?: boolean, error?: string}>} */
function removeTranscript(payload) {
  return ipcRenderer.invoke("viewer:removeTranscript", payload);
}

/** Save the transcript's sync offset.
 *  @param {{sessionFolder: string, offsetMs: number}} payload
 *  @returns {Promise<{ok: boolean, error?: string}>} */
function saveTranscriptSync(payload) {
  return ipcRenderer.invoke("viewer:saveTranscriptSync", payload);
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

module.exports = {
  loadSession, openSessionFolder,
  runNormalizeExtended, cancelNormalize,
  saveAnnotations,
  rememberStepName, readRememberedNames, forgetStepName,
  readProcesses, saveProcess, undoSaveProcess, forgetProcess,
  exportFile, saveSvgFile, revealFile, openExternal,
  attachExternalVideo, saveExternalVideoSync,
  importTranscript, removeTranscript, saveTranscriptSync,
  onNormalizeLog, onOpenInitialSession,
};
