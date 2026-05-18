/*
 * vocab-view.js -- the App Library (Vocabularies) tab.
 *
 * A form editor over the per-app vocabulary YAML files: list the
 * vocabularies on disk, edit one as a form (display name, scope,
 * interactions), and save it back via IPC. Self-contained -- it does
 * not touch the Session, Flow, or timeline surfaces.
 */

"use strict";

const { $, escapeHtml, escapeAttr, toast } = require("../dom.js");
const { confirmModal, promptModal } = require("../modals.js");
const State = require("../state.js");
const Ipc = require("../ipc.js");

async function reloadVocabList() {
  const r = await Ipc.listAppVocabs();
  State.getVocabState().list = (r && r.vocabs) || [];
  const meta = $("#vocab-list-meta");
  if (meta) {
    if (State.getVocabState().list.length) {
      meta.textContent = State.getVocabState().list.length + " vocab(s) across " + ((r.dirs || []).length) + " folder(s)";
    } else {
      meta.textContent = "no vocabularies yet";
    }
  }
  renderVocabList();
  if (State.getVocabState().selectedPath && !State.getVocabState().list.some(v => v.path === State.getVocabState().selectedPath)) {
    State.getVocabState().selectedPath = null;
    State.getVocabState().current = null;
    renderVocabEditor();
  } else if (State.getVocabState().selectedPath) {
    await selectVocab(State.getVocabState().selectedPath);
  } else {
    renderVocabEditor();
  }
}

function renderVocabList() {
  const host = $("#vocab-list");
  if (!host) return;
  if (!State.getVocabState().list.length) {
    host.innerHTML =
      '<div class="empty-pane">' +
      '<p><strong>No vocabularies yet.</strong></p>' +
      '<p>Two ways to start:</p>' +
      '<ol>' +
      '<li>Click <strong>+ New vocabulary</strong> above to start an empty one.</li>' +
      '<li>Capture a prep session from the tracker tray (<em>Start app vocabulary prep session...</em>), then bootstrap from it.</li>' +
      '</ol>' +
      '</div>';
    return;
  }
  host.innerHTML = "";
  for (const v of State.getVocabState().list) {
    const row = document.createElement("div");
    row.className = "vocab-row" + (v.path === State.getVocabState().selectedPath ? " selected" : "");
    row.innerHTML =
      '<div class="vocab-row-head">' +
      '<span class="vocab-row-name">' + escapeHtml(v.name || v.id) + '</span>' +
      '<span class="vocab-row-count">' + v.interaction_count + '</span>' +
      '</div>' +
      '<div class="vocab-row-meta">' + escapeHtml(v.id) + ' · v' + v.version + ' · ' + escapeHtml(v.file) + '</div>';
    row.addEventListener("click", () => selectVocab(v.path));
    host.appendChild(row);
  }
}

async function selectVocab(p) {
  if (State.getVocabState().dirty) {
    const ok = await confirmModal({
      title: "Unsaved changes",
      message: "Discard unsaved changes to this vocabulary?",
      okLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
  }
  State.getVocabState().selectedPath = p;
  State.getVocabState().dirty = false;
  const v = await Ipc.readVocab(p);
  if (!v) {
    State.getVocabState().current = null;
    toast("Could not read vocab file", "error");
  } else if (v._error) {
    State.getVocabState().current = null;
    toast("Vocab YAML parse error: " + v._error, "error");
  } else {
    State.getVocabState().current = v;
  }
  renderVocabList();
  renderVocabEditor();
  const btn = $("#btn-vocab-open-yaml");
  if (btn) btn.disabled = !p;
}

function renderVocabEditor() {
  const host = $("#vocab-editor");
  if (!host) return;
  const v = State.getVocabState().current;
  if (!v) {
    host.innerHTML =
      '<div class="empty-pane">' +
      '<p>Pick a vocabulary on the left to edit it, or click <strong>+ New vocabulary</strong> above to create one.</p>' +
      '<p class="meta">The editor renders the YAML as a form. The underlying file is rewritten on save; you can also edit the YAML directly with <em>Open YAML in editor</em>.</p>' +
      '</div>';
    return;
  }
  const interactions = v.interactions || [];
  const scope = v.scope || {};
  host.innerHTML =
    '<div class="vocab-head">' +
    '<label>Display name<input type="text" id="vocab-name" value="' + escapeAttr(v.name || "") + '" placeholder="e.g., Salesforce"></label>' +
    '<label>Internal id<input type="text" id="vocab-id" value="' + escapeAttr(v.id || "") + '" placeholder="salesforce"></label>' +
    '<label>Version<input type="number" id="vocab-version" value="' + escapeAttr(v.version || 1) + '" min="1" step="1"></label>' +
    '</div>' +
    '<div class="vocab-head">' +
    '<label>Scope: process name (.exe)<input type="text" id="vocab-scope-proc" value="' + escapeAttr(scope.process_name || "") + '" placeholder="chrome.exe"></label>' +
    '<label>Scope: window title regex (optional)<input type="text" id="vocab-scope-title" value="' + escapeAttr(scope.window_title_regex || "") + '" placeholder=".*Salesforce.*"></label>' +
    '</div>' +
    '<div class="vocab-toolbar">' +
    '<strong>Interactions (' + interactions.length + ')</strong>' +
    '<span class="flex-spacer"></span>' +
    '<button id="btn-vocab-add-interaction">+ Add interaction</button>' +
    '<button id="btn-vocab-save" class="primary">Save vocabulary</button>' +
    '</div>' +
    '<div id="vocab-interactions"></div>';
  renderVocabInteractions();
  $("#vocab-name").addEventListener("input", markDirty);
  $("#vocab-id").addEventListener("input", markDirty);
  $("#vocab-version").addEventListener("input", markDirty);
  $("#vocab-scope-proc").addEventListener("input", markDirty);
  $("#vocab-scope-title").addEventListener("input", markDirty);
  $("#btn-vocab-add-interaction").addEventListener("click", addInteraction);
  $("#btn-vocab-save").addEventListener("click", saveVocab);
}

function _buildVocabIntRow(ent, i) {
  const sig = ent.signature || {};
  const sigParts = [sig.control_type, sig.automation_id, sig.name].filter(Boolean);
  const sigSummary = sigParts.length ? sigParts.join(" · ") : "(unset signature)";
  // I57: a bootstrapped entry carries how many times the control was
  // observed -- show it so the analyst can prioritise.
  const seen = (typeof ent.seen_count === "number")
    ? '<span class="vocab-int-seen" title="Times this control was used in the prep session">seen ' + ent.seen_count + '×</span>'
    : "";
  const row = document.createElement("div");
  row.className = "vocab-int";
  row.dataset.idx = String(i);
  row.innerHTML =
    '<div class="vocab-int-head">' +
    '<span class="vocab-int-num">' + (i + 1) + '</span>' +
    '<div class="vocab-int-sig">' + escapeHtml(sigSummary) + '</div>' +
    seen +
    '<button class="icon-btn vocab-int-remove" title="Remove">✕</button>' +
    '</div>' +
    '<div class="vocab-int-body">' +
    '<label>Meaningful name<input type="text" data-field="name" value="' + escapeAttr(ent.name || "") + '" placeholder="e.g., Search customer record"></label>' +
    '<div class="vocab-int-sig-fields">' +
    '<label>control_type<input type="text" data-sig="control_type" value="' + escapeAttr(sig.control_type || "") + '"></label>' +
    '<label>automation_id<input type="text" data-sig="automation_id" value="' + escapeAttr(sig.automation_id || "") + '"></label>' +
    '<label>name (raw)<input type="text" data-sig="name" value="' + escapeAttr(sig.name || "") + '"></label>' +
    '<label>window_title_regex<input type="text" data-sig="window_title_regex" value="' + escapeAttr(sig.window_title_regex || "") + '"></label>' +
    '</div>' +
    '</div>';
  row.querySelector(".vocab-int-remove").addEventListener("click", () => removeInteraction(i));
  row.querySelectorAll("[data-field], [data-sig], [data-flag]").forEach((el) => {
    el.addEventListener("input", collectAndMark);
    el.addEventListener("change", collectAndMark);
  });
  return row;
}

function renderVocabInteractions() {
  const host = $("#vocab-interactions");
  if (!host) return;
  const interactions = (State.getVocabState().current && State.getVocabState().current.interactions) || [];
  if (!interactions.length) {
    host.innerHTML = '<p class="hint">No interactions yet. Click + Add interaction, or bootstrap from a prep session in the tracker tray.</p>';
    return;
  }
  host.innerHTML = "";
  /* I57: a bootstrapped vocab is frequency-ranked, so rarely-seen
     controls (seen_count <= 2) cluster at the tail. Fold a clean
     uncommon tail under a disclosure so the analyst names the
     high-traffic controls first. The rows stay descendants of
     #vocab-interactions in original order, so collectAndMark still
     reads them correctly on save. */
  const isUncommon = (e) => typeof e.seen_count === "number" && e.seen_count <= 2;
  let foldFrom = interactions.length;
  while (foldFrom > 0 && isUncommon(interactions[foldFrom - 1])) foldFrom--;
  const cleanTail = foldFrom < interactions.length &&
    interactions.slice(0, foldFrom).every((e) => !isUncommon(e));
  if (!cleanTail) foldFrom = interactions.length;

  for (let i = 0; i < foldFrom; i++) {
    host.appendChild(_buildVocabIntRow(interactions[i], i));
  }
  if (foldFrom < interactions.length) {
    const det = document.createElement("details");
    det.className = "vocab-uncommon";
    const sum = document.createElement("summary");
    sum.textContent = "Show uncommon fields (" + (interactions.length - foldFrom) + ")";
    det.appendChild(sum);
    for (let i = foldFrom; i < interactions.length; i++) {
      det.appendChild(_buildVocabIntRow(interactions[i], i));
    }
    host.appendChild(det);
  }
}

function collectAndMark() {
  const v = State.getVocabState().current;
  if (!v) return;
  v.name = $("#vocab-name").value.trim();
  v.id = $("#vocab-id").value.trim();
  v.version = parseInt($("#vocab-version").value, 10) || 1;
  v.scope = v.scope || {};
  const proc = $("#vocab-scope-proc").value.trim();
  const titleR = $("#vocab-scope-title").value.trim();
  if (proc) v.scope.process_name = proc; else delete v.scope.process_name;
  if (titleR) v.scope.window_title_regex = titleR; else delete v.scope.window_title_regex;
  const rows = document.querySelectorAll("#vocab-interactions .vocab-int");
  v.interactions = [];
  rows.forEach(row => {
    const sig = {};
    row.querySelectorAll("[data-sig]").forEach(el => {
      const k = el.dataset.sig;
      const val = el.value.trim();
      if (val) sig[k] = val;
    });
    const ent = {
      signature: sig,
      name: row.querySelector('[data-field="name"]').value.trim() || "",
    };
    const flags = {};
    row.querySelectorAll("[data-flag]").forEach(el => {
      if (el.checked) flags[el.dataset.flag] = true;
    });
    if (Object.keys(flags).length) ent.flags = flags;
    v.interactions.push(ent);
  });
  markDirty();
}

function markDirty() {
  State.getVocabState().dirty = true;
  const btn = $("#btn-vocab-save");
  if (btn) btn.textContent = "Save vocabulary*";
}

function addInteraction() {
  const v = State.getVocabState().current;
  if (!v) return;
  v.interactions = v.interactions || [];
  v.interactions.push({ signature: { control_type: "Button", name: "" }, name: "" });
  const newIdx = v.interactions.length - 1;
  renderVocabInteractions();
  markDirty();
  // Make the freshly-added row obvious: scroll it into view, flash a
  // highlight, and focus its name field so the analyst can type at once.
  const host = $("#vocab-interactions");
  const row = host && host.querySelector('.vocab-int[data-idx="' + newIdx + '"]');
  if (row) {
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    row.classList.add("vocab-int-new");
    setTimeout(() => row.classList.remove("vocab-int-new"), 1500);
    const nameInput = row.querySelector('[data-field="name"]');
    if (nameInput) nameInput.focus();
  }
}

function removeInteraction(idx) {
  const v = State.getVocabState().current;
  if (!v) return;
  v.interactions.splice(idx, 1);
  renderVocabInteractions();
  markDirty();
}

async function saveVocab() {
  if (!State.getVocabState().selectedPath || !State.getVocabState().current) return;
  collectAndMark();
  const r = await Ipc.writeVocab({
    path: State.getVocabState().selectedPath,
    vocab: State.getVocabState().current,
  });
  if (!r || !r.ok) {
    toast("Save failed: " + ((r && r.error) || "unknown"), "error");
    return;
  }
  State.getVocabState().dirty = false;
  const btn = $("#btn-vocab-save");
  if (btn) btn.textContent = "Save vocabulary";
  toast("App Library entry saved — re-analyze any session to apply", "success");
  reloadVocabList();
}

/* Wire the App Library tab controls. Call once at boot. */
function initVocabView() {
  if ($("#btn-vocab-new")) {
    $("#btn-vocab-new").addEventListener("click", async () => {
      const name = await promptModal({ title: "New App Library entry", message: "Which app is this entry for?", placeholder: "e.g., Salesforce", okLabel: "Create" });
      if (!name) return;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const p = await Ipc.newVocabFile({ suggestedId: id });
      if (!p) return;
      await reloadVocabList();
      await selectVocab(p);
      toast("New App Library entry created — fill in interactions in plain English and save", "success");
    });
  }
  if ($("#btn-vocab-reload")) {
    $("#btn-vocab-reload").addEventListener("click", reloadVocabList);
  }
  if ($("#btn-vocab-open-yaml")) {
    $("#btn-vocab-open-yaml").addEventListener("click", () => {
      if (State.getVocabState().selectedPath) Ipc.openVocabFile(State.getVocabState().selectedPath);
    });
  }
}

module.exports = { initVocabView, reloadVocabList };
