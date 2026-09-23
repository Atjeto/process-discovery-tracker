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

/** Open a mined diagram (.bpmn) via its guarded sink. Resolves to a string
 *  error or null on success. @param {string} filePath @returns {Promise<?string>} */
function openDiagram(filePath) {
  return ipcRenderer.invoke("viewer:openDiagram", filePath);
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
  exportFile, saveSvgFile, revealFile, openExternal, openDiagram,
  attachExternalVideo, saveExternalVideoSync,
  onNormalizeLog, onOpenInitialSession,
};
