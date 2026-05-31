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
const CA = require("../canonical-author.js");

// Discovery-provenance fields the picker stamps on each entry (ADR-0025).
// They drive the editor's "why this signature" legend but are stripped
// before save so the persisted vocab stays signature-focused.
const DISCOVERY_META_KEYS = ["identity_source", "confidence", "volatile_aids", "_hint"];

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
      '<button type="button" class="vocab-row-del" title="Delete this vocabulary">✕</button>' +
      '</div>' +
      '<div class="vocab-row-meta">' + escapeHtml(v.id) + ' · v' + v.version + ' · ' + escapeHtml(v.file) + '</div>';
    row.addEventListener("click", () => selectVocab(v.path));
    const del = row.querySelector(".vocab-row-del");
    if (del) del.addEventListener("click", (ev) => { ev.stopPropagation(); deleteVocabEntry(v); });
    host.appendChild(row);
  }
}

/* Delete an App Library vocabulary (the inverse of + New / Discover). Confirms
   first; analyzed sessions keep their results, only future analyses stop using
   it. reloadVocabList clears the editor if the deleted entry was open. */
async function deleteVocabEntry(v) {
  const ok = await confirmModal({
    title: "Delete vocabulary?",
    message: "Delete the “" + (v.name || v.id) + "” App Library entry (" + v.file + ")? " +
      "Sessions you've already analyzed keep their results; future analyses just won't use it. This can't be undone.",
    okLabel: "Delete",
  });
  if (!ok) return;
  const r = await Ipc.deleteVocab(v.path);
  if (!r || r.error) { toast("Couldn't delete: " + ((r && r.error) || "unknown"), "error"); return; }
  await reloadVocabList();
  toast("Deleted “" + (v.name || v.id) + "”.", "success");
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
  // observed -- show it (only when >1, so a single static snapshot control
  // doesn't read as a misleading "seen 1×").
  const seen = (typeof ent.seen_count === "number" && ent.seen_count > 1)
    ? '<span class="vocab-int-seen" title="Distinct controls that share this signature">×' + ent.seen_count + '</span>'
    : "";
  // ADR-0025 legend: when a signature was AUTO-DISCOVERED, show WHY -- the
  // identity_source rung it was keyed on + the confidence (ADR-0023), so the
  // analyst sees the picker's reasoning before confirming/overriding.
  let conf = "";
  if (typeof ent.confidence === "number") {
    const tier = ent.confidence >= 0.9 ? "strong" : (ent.confidence >= 0.6 ? "ok" : "weak");
    conf = '<span class="vocab-int-conf ' + tier + '" title="Auto-discovered: keyed on ' +
      escapeAttr(ent.identity_source || "?") + ' (ADR-0023 confidence ' + ent.confidence + ')">' +
      escapeHtml(ent.identity_source || "?") + ' ' + ent.confidence + '</span>';
  }
  // The volatility note: the per-render automation_id(s) the picker REJECTED
  // (changed across the two snapshot passes, or matched a volatility pattern),
  // which is why this entry is keyed on the label instead of the id.
  const vol = (Array.isArray(ent.volatile_aids) && ent.volatile_aids.length)
    ? '<div class="vocab-int-volatile" title="These automation_ids changed across snapshot passes or match a per-render pattern, so discovery keyed on the label instead.">⚠ volatile id rejected: ' +
      escapeHtml(ent.volatile_aids.join(", ")) + ' → keyed on label</div>'
    : "";
  const row = document.createElement("div");
  row.className = "vocab-int";
  row.dataset.idx = String(i);
  row.innerHTML =
    '<div class="vocab-int-head">' +
    '<span class="vocab-int-num">' + (i + 1) + '</span>' +
    '<div class="vocab-int-sig">' + escapeHtml(sigSummary) + '</div>' +
    conf +
    seen +
    '<button class="icon-btn vocab-int-remove" title="Remove">✕</button>' +
    '</div>' +
    '<div class="vocab-int-body">' +
    vol +
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
  // Don't fold when there's no common head to keep (foldFrom === 0) -- e.g. a
  // freshly DISCOVERED vocab where every control was seen once: folding would
  // hide the entire list behind a disclosure. Show everything in that case.
  if (!cleanTail || foldFrom === 0) foldFrom = interactions.length;

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

/* Merge edited fields onto a prior vocab interaction entry. Clones the
   prior entry so unmodeled fields survive a save -- most importantly the
   bootstrapped `seen_count` frequency ranking, which used to be dropped
   (H-3) because save rewrote each entry from scratch. Overwrites ONLY
   `signature` and `name`; sets `flags` when any flag is checked and
   removes it otherwise (an entry with no flags carries no `flags` key).
   Pure -- exported for unit testing. */
function mergeVocabEntry(priorEntry, { signature, name, flags }) {
  const ent = { ...(priorEntry || {}) };
  ent.signature = signature || {};
  ent.name = name || "";
  if (flags && Object.keys(flags).length) ent.flags = flags;
  else delete ent.flags;
  return ent;
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
  // Capture the prior entries before we rebuild: each row's data-idx
  // points back into this array, and we clone its entry so unmodeled
  // fields (notably the bootstrapped `seen_count` frequency ranking)
  // survive a save instead of being silently dropped.
  const prior = v.interactions || [];
  const next = [];
  rows.forEach(row => {
    const sig = {};
    row.querySelectorAll("[data-sig]").forEach(el => {
      const k = el.dataset.sig;
      const val = el.value.trim();
      if (val) sig[k] = val;
    });
    const idx = parseInt(row.dataset.idx, 10);
    const base = (Number.isInteger(idx) && prior[idx]) ? prior[idx] : {};
    const flags = {};
    row.querySelectorAll("[data-flag]").forEach(el => {
      if (el.checked) flags[el.dataset.flag] = true;
    });
    const name = row.querySelector('[data-field="name"]').value.trim() || "";
    next.push(mergeVocabEntry(base, { signature: sig, name, flags }));
  });
  v.interactions = next;
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

/* Strip ADR-0025 discovery-provenance fields from a vocab before persisting,
   so the saved file stays signature-focused (the matcher ignores them, and
   the committed hand-authored vocabs don't carry them). Returns a clone --
   the in-memory copy keeps the legend fields for continued display. */
function stripDiscoveryMeta(vocab) {
  const clone = JSON.parse(JSON.stringify(vocab || {}));
  for (const it of (clone.interactions || [])) {
    for (const k of DISCOVERY_META_KEYS) delete it[k];
  }
  return clone;
}

async function saveVocab() {
  if (!State.getVocabState().selectedPath || !State.getVocabState().current) return;
  collectAndMark();
  const r = await Ipc.writeVocab({
    path: State.getVocabState().selectedPath,
    vocab: stripDiscoveryMeta(State.getVocabState().current),
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

/* Merge named screens additively (new ids appended; existing kept). */
function mergeScreens(existing, incoming) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const ids = new Set(out.map((s) => s && s.id).filter(Boolean));
  for (const s of (incoming || [])) {
    if (s && s.id && !ids.has(s.id)) { out.push(s); ids.add(s.id); }
  }
  return out;
}

/* Merge-aware re-discovery (ADR-0025 inverse): diff a discovered skeleton
   INTO an existing vocab. New controls are added; analyst-named ones are
   PRESERVED (CA.mergeInteractionsIntoVocab keeps the existing entry on a
   signature collision). Screens merge additively; the discovered scope is
   adopted only when the target has none yet (never clobbers a tuned scope).
   Pure -- exported for unit testing. */
function mergeDiscoveredSkeleton(currentVocab, skeleton) {
  const v = currentVocab || {};
  const incoming = (skeleton && skeleton.interactions) || [];
  const wasEmpty = !((v.interactions || []).length);
  const merged = CA.mergeInteractionsIntoVocab(v, incoming);
  const out = merged.vocab;   // { ...v, interactions }
  out.screens = mergeScreens(v.screens, skeleton && skeleton.screens);
  const curScope = v.scope || {};
  if (wasEmpty && skeleton && skeleton.scope &&
      !curScope.process_name && !curScope.window_title_regex) {
    out.scope = Object.assign({}, skeleton.scope);
  }
  return { vocab: out, added: merged.added, skipped: merged.skipped };
}

/* "Discover from window" -- point at a prepared app window and auto-build a
   stable-signature skeleton from its live UI (ADR-0025). Targets the SELECTED
   vocab (merge-aware re-discovery); when none is selected, creates a new one
   first. On-device: the recorder snapshots locally and nothing is saved until
   the analyst presses Save. */
async function discoverFromWindow() {
  let v = State.getVocabState().current;
  let p = State.getVocabState().selectedPath;
  if (!v || !p) {
    const name = await promptModal({
      title: "Discover from window",
      message: "Which app is this for? (Tip: pick an existing entry on the left first to MERGE discovery into it.)",
      placeholder: "e.g., Salesforce", okLabel: "Continue",
    });
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    p = await Ipc.newVocabFile({ suggestedId: id });
    if (!p) return;
    await reloadVocabList();
    await selectVocab(p);
    v = State.getVocabState().current;
    if (!v) { toast("Couldn't open the new App Library file", "error"); return; }
    v.name = name;
  }
  const proceed = await confirmModal({
    title: "Discover from a window",
    message: "Next, CLICK the window you want to learn — the app or web page whose controls you want to capture (for a web app, let the page finish loading first). You will confirm your pick before anything is captured; press Esc while picking to cancel. On-device — nothing is saved or sent until you press Save.",
    okLabel: "Point to a window…",
  });
  if (!proceed) return;
  const btn = $("#btn-vocab-discover");
  if (btn) { btn.disabled = true; btn.textContent = "Click a window…"; }
  try {
    // Point-and-click: enter standby, the operator clicks the target window,
    // then confirm before snapshotting THAT window (not the foreground — whose
    // own button click would steal it). ADR-0025.
    const picked = await Ipc.pickWindow({ timeoutMs: 35000 });
    if (!picked || picked.error) {
      toast("Window pick failed: " + ((picked && picked.error) || "unknown"), "error");
      return;
    }
    if (picked.cancelled) { toast("Window pick cancelled.", "info"); return; }
    const pickedTitle = picked.window_title || "(untitled window)";
    const confirmCapture = await confirmModal({
      title: "Capture this window?",
      message: "You clicked “" + pickedTitle + "”. Capture this window's controls? " +
        "The recorder snapshots its live UI twice (~2s) to find stable element signatures.",
      okLabel: "Capture it",
    });
    if (!confirmCapture) return;
    if (btn) btn.textContent = "Discovering…";
    const r = await Ipc.discoverFromWindow({ target: picked.hwnd, vocabId: v.id, vocabName: v.name });
    if (!r || r.error) {
      toast("Discovery failed: " + ((r && r.error) || "unknown"), "error");
      return;
    }
    const skeleton = (r.skeleton && r.skeleton.app_vocabulary) || null;
    if (!skeleton || !((skeleton.interactions || []).length)) {
      toast("No controls discovered in that window.", "error");
      return;
    }
    const merged = mergeDiscoveredSkeleton(v, skeleton);
    State.getVocabState().current = merged.vocab;
    renderVocabEditor();
    markDirty();
    toast("Discovered " + r.control_count + " controls from “" + (r.window_title || "window") +
      "” — " + merged.added + " new, " + merged.skipped + " already present. Review names and Save.",
      "success");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Discover from window…"; }
  }
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
  if ($("#btn-vocab-discover")) {
    $("#btn-vocab-discover").addEventListener("click", discoverFromWindow);
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

module.exports = {
  initVocabView, reloadVocabList, mergeVocabEntry,
  mergeDiscoveredSkeleton, mergeScreens, stripDiscoveryMeta,
};
