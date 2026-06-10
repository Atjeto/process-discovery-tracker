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

/** @returns {Promise<any>} chosen folder paths, or null */
function openMultipleSessions() {
  return ipcRenderer.invoke("viewer:openMultipleSessions");
}

/** @param {string[]} folders @returns {Promise<any>} */
function loadMultipleSessions(folders) {
  return ipcRenderer.invoke("viewer:loadMultipleSessions", folders);
}

/* ---- Normalization ---- */

/** @param {object} opts @returns {Promise<any>} */
function runNormalize(opts) {
  return ipcRenderer.invoke("viewer:runNormalize", opts);
}

/** @param {object} opts @returns {Promise<any>} */
function runNormalizeExtended(opts) {
  return ipcRenderer.invoke("viewer:runNormalizeExtended", opts);
}

/** @param {object} payload @returns {Promise<any>} */
function testCanonicalMatch(payload) {
  return ipcRenderer.invoke("viewer:testCanonicalMatch", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function bootstrapAppVocab(payload) {
  return ipcRenderer.invoke("viewer:bootstrapAppVocab", payload);
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

/** @param {object} payload @returns {Promise<any>} */
function addClassificationOverride(payload) {
  return ipcRenderer.invoke("viewer:addClassificationOverride", payload);
}

/** Promote classification rules into a shared taxonomy.yaml (team-wide).
 * @param {{rules: Array}} payload @returns {Promise<any>} */
function promoteTaxonomyRules(payload) {
  return ipcRenderer.invoke("viewer:promoteTaxonomyRules", payload);
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

/** @param {object} payload @returns {Promise<any>} */
function saveHtmlFile(payload) {
  return ipcRenderer.invoke("viewer:saveHtmlFile", payload);
}

/** Generic save-text-as dialog (Copy-for-LLM JSON, §C3).
 * @param {object} payload { content, suggestedName, title?, filterName?, filterExt? }
 * @returns {Promise<any>} { ok, path } | { ok:false, error } | null on cancel */
function saveTextFile(payload) {
  return ipcRenderer.invoke("viewer:saveTextFile", payload);
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

/* ---- Canonical (Process Template) files ---- */

/** @returns {Promise<any>} */
function openCanonicalFile() {
  return ipcRenderer.invoke("viewer:openCanonicalFile");
}

/** @param {object} payload @returns {Promise<any>} */
function saveCanonicalFile(payload) {
  return ipcRenderer.invoke("viewer:saveCanonicalFile", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function newCanonicalFile(payload) {
  return ipcRenderer.invoke("viewer:newCanonicalFile", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function deleteCanonicalFile(payload) {
  return ipcRenderer.invoke("viewer:deleteCanonicalFile", payload);
}

/** @param {string} canonicalPath @returns {Promise<any>} */
function listTemplateVersions(canonicalPath) {
  return ipcRenderer.invoke("viewer:listTemplateVersions", canonicalPath);
}

/** @param {string} filePath @returns {Promise<any>} */
function readTemplateFile(filePath) {
  return ipcRenderer.invoke("viewer:readTemplateFile", filePath);
}

/* ---- App vocabularies ---- */

/** @returns {Promise<any>} */
function listAppVocabs() {
  return ipcRenderer.invoke("viewer:listAppVocabs");
}

/** @param {object} payload @returns {Promise<any>} */
function saveAppVocab(payload) {
  return ipcRenderer.invoke("viewer:saveAppVocab", payload);
}

/** @param {string} filePath @returns {Promise<any>} */
function readVocab(filePath) {
  return ipcRenderer.invoke("viewer:readVocab", filePath);
}

/** @param {object} payload @returns {Promise<any>} */
function writeVocab(payload) {
  return ipcRenderer.invoke("viewer:writeVocab", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function newVocabFile(payload) {
  return ipcRenderer.invoke("viewer:newVocabFile", payload);
}

/** @param {string} filePath @returns {Promise<any>} */
function openVocabFile(filePath) {
  return ipcRenderer.invoke("viewer:openVocabFile", filePath);
}

/** ADR-0025: discover a stable-signature vocab skeleton from a live window.
 *  @param {object} payload { target?, passes?, vocabId?, vocabName? }
 *  @returns {Promise<any>} { ok, skeleton, window_title, control_count } | { error } */
function discoverFromWindow(payload) {
  return ipcRenderer.invoke("viewer:discoverFromWindow", payload);
}

/** ADR-0025: point-and-click window pick. Enters standby; resolves the window
 *  the operator clicks. @returns {Promise<any>} { hwnd, window_title, process_id } | { cancelled, reason } | { error } */
function pickWindow(payload) {
  return ipcRenderer.invoke("viewer:pickWindow", payload || {});
}

/** Delete an App Library vocabulary file by path. @returns {Promise<any>} { deleted } | { error } */
function deleteVocab(p) {
  return ipcRenderer.invoke("viewer:deleteVocab", p);
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

/* ---- Projects ---- */

/** @param {object} payload @returns {Promise<any>} */
function saveProjectAs(payload) {
  return ipcRenderer.invoke("viewer:saveProjectAs", payload);
}

/** @param {object} payload @returns {Promise<any>} */
function saveProject(payload) {
  return ipcRenderer.invoke("viewer:saveProject", payload);
}

/** @returns {Promise<any>} */
function openProject() {
  return ipcRenderer.invoke("viewer:openProject");
}

/** @param {string} filePath @returns {Promise<any>} */
function loadProjectFile(filePath) {
  return ipcRenderer.invoke("viewer:loadProjectFile", filePath);
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
  loadSession, openSessionFolder, openMultipleSessions, loadMultipleSessions,
  runNormalize, runNormalizeExtended, testCanonicalMatch, bootstrapAppVocab,
  cancelNormalize,
  saveAnnotations, addClassificationOverride, promoteTaxonomyRules,
  exportFile, saveSvgFile, saveHtmlFile, saveTextFile, revealFile, openExternal, openDiagram,
  openCanonicalFile, saveCanonicalFile, newCanonicalFile, deleteCanonicalFile, listTemplateVersions, readTemplateFile,
  listAppVocabs, saveAppVocab, readVocab, writeVocab, newVocabFile, openVocabFile,
  discoverFromWindow, pickWindow, deleteVocab,
  attachExternalVideo, saveExternalVideoSync,
  saveProjectAs, saveProject, openProject, loadProjectFile,
  onNormalizeLog, onOpenInitialSession,
};
