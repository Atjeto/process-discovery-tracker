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
const { confirmModal, promptModal, checklistModal, pickerModal } = require("../modals.js");
const State = require("../state.js");
const Ipc = require("../ipc.js");
const CA = require("../canonical-author.js");
const Posture = require("../posture.js");
const LlmExport = require("../llm-export.js");
const VocabMatch = require("../vocab-match.js");

// Renderer-injected callback: re-run the pipeline on the loaded session so
// newly-authored names take effect (reuses the existing "Analyze session"
// path — NEVER auto-triggered; the analyst clicks the workbench CTA). Set by
// initVocabView({ onReanalyze }).
let onReanalyze = null;

// Discovery-provenance fields the picker stamps on each entry (ADR-0025).
// They drive the editor's "why this signature" legend + annotator context
// (role / framework / on-screen region / tree ancestry / merged members) but
// are stripped before save so the persisted vocab stays signature-focused.
// `_reviewed` is the C2 checklist tick -- a review-pass aid, not data.
const DISCOVERY_META_KEYS = [
  "identity_source", "confidence", "volatile_aids", "_hint",
  "role", "framework", "region", "ancestry", "_members", "_reviewed",
];

// C1 semantic columns persisted on a vocab entry (mirror of
// app_vocab.SEMANTIC_FIELDS -- additive, absent on pre-C1 vocabs).
const SEMANTIC_TEXT_FIELDS = ["object", "means"];
const SEMANTIC_FLAG_FIELDS = ["completion", "carries_value", "case_id_source"];
// The auto-derivable verb list (app_vocab.VERBS). An authored vocab may
// carry any string; the select keeps a custom value as an extra option.
const VERBS = ["enter", "select", "click", "submit", "toggle", "open"];

/* A row joins the discovery review checklist when the picker stamped
   provenance on it (a hand-added row has none -- the analyst IS its review). */
function isDiscoveredEntry(ent) {
  return !!(ent && (ent.identity_source !== undefined
    || ent.confidence !== undefined || ent._hint !== undefined));
}

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
      '<p><strong>No app vocabularies yet — and you may not need any.</strong></p>' +
      '<p>Reading a recording you received works without this: the Overview summary, findings and step groups stand on their own. A vocabulary is worth building when you will record the <em>same</em> process again. Ways to start one:</p>' +
      '<ol>' +
      '<li>Click <strong>Start from a recording…</strong> above to read every control a saved recording used and name one of its apps — no live app needed.</li>' +
      '<li>Click <strong>+ New vocabulary</strong> to start an empty one by hand.</li>' +
      '<li>Or capture a quick prep session from the tracker tray, then start from it.</li>' +
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

/* The App Library editor host. When a session is loaded and a vocab is
   selected, the DEFAULT surface is the MATCH WORKBENCH (session × vocab): a
   resident coverage sentence + three evidence lists (matched / unnamed / dead
   rules) + the observed-screens split, all computed from the captured
   interactions. The blank-form rule editor demotes to a Machine drawer at the
   bottom (▸ MACHINE LAYER: rule editor); no capability is removed. Without a
   session (or vocab) we show the honest empty state / the rule editor alone. */
function renderVocabEditor() {
  const host = $("#vocab-editor");
  if (!host) return;
  const v = State.getVocabState().current;
  const sess = State.getSession();
  if (!v) {
    // No vocab selected — the empty state depends on whether a session is open.
    host.innerHTML = renderNoVocabEmptyState(!!sess);
    return;
  }
  if (sess && Array.isArray(sess.events)) {
    renderWorkbench(host, v, sess);
    return;
  }
  // No session loaded: the workbench has no evidence to stand on. Show the
  // honest CTA + the rule editor so hand-authoring still works.
  host.innerHTML =
    '<div class="wb-nosession empty-pane">' +
    '<p><strong>Open a session to see this vocabulary matched against real captures.</strong></p>' +
    '<p class="meta">The match workbench needs a loaded recording: it shows which captured controls this vocabulary named, which it missed, and which rules matched nothing. Open a session on the <strong>Session</strong> tab, then come back. You can still hand-edit the rules below.</p>' +
    '</div>' +
    '<div id="vocab-machine-host"></div>';
  renderRuleEditorDrawer($("#vocab-machine-host"), v, { forceOpen: true });
}

/* The blank-form rule editor — the Machine layer. Rendered inside a named,
   collapsed drawer (Memo/Evidence/Machine: this is Machine). Its DOM ids
   (#vocab-interactions, #btn-vocab-save, the toolbar) are UNCHANGED so all
   existing wiring + e2e selectors keep working; only its residence moved. */
function renderRuleEditorDrawer(host, v, opts) {
  if (!host) return;
  opts = opts || {};
  const open = opts.forceOpen || State.getVocabState()._ruleEditorOpen;
  const det = document.createElement("details");
  det.className = "vocab-machine-drawer";
  if (open) det.open = true;
  det.innerHTML =
    '<summary class="vocab-machine-summary">' +
    '<span class="vocab-machine-chevron"></span>' +
    '<span>Machine layer: rule editor</span>' +
    '</summary>' +
    '<div class="vocab-machine-body" id="vocab-rule-editor"></div>';
  host.innerHTML = "";
  host.appendChild(det);
  det.addEventListener("toggle", () => { State.getVocabState()._ruleEditorOpen = det.open; });
  renderRuleEditor($("#vocab-rule-editor"), v);
}

/* The old renderVocabEditor body, now targeting an explicit host so it can live
   inside the Machine drawer. Unchanged markup + wiring. */
function renderRuleEditor(host, v) {
  if (!host) return;
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
    '<span class="vocab-review-progress" id="vocab-review-progress" title="Discovered rows arrive pre-filled (signature, verb, flags) — tick each as reviewed; the count tracks your pass"></span>' +
    '<span class="flex-spacer"></span>' +
    '<button id="btn-vocab-approve-all" title="Mark every discovered row as reviewed (the inverse is per-row: untick its “reviewed” box)">✓ Approve all</button>' +
    '<button id="btn-vocab-add-interaction">+ Add interaction</button>' +
    '<button id="btn-vocab-save" class="primary">Save vocabulary</button>' +
    '</div>' +
    '<div id="vocab-interactions"></div>';
  renderVocabInteractions();
  updateReviewProgress();
  $("#vocab-name").addEventListener("input", markDirty);
  $("#vocab-id").addEventListener("input", markDirty);
  $("#vocab-version").addEventListener("input", markDirty);
  $("#vocab-scope-proc").addEventListener("input", markDirty);
  $("#vocab-scope-title").addEventListener("input", markDirty);
  $("#btn-vocab-approve-all").addEventListener("click", approveAllDiscovered);
  $("#btn-vocab-add-interaction").addEventListener("click", addInteraction);
  $("#btn-vocab-save").addEventListener("click", saveVocab);
}

/* ===================================================================
   R2 — the MATCH WORKBENCH (APPROACHABILITY-REDESIGN §5 R2)
   The default App Library surface for (session × vocab): the analyst looks
   at what the session CAPTURED, points, and names; signatures are derived,
   never typed. Advisory matching via vocab-match.js (mirrors app_vocab.py);
   the pipeline stays ground truth (a re-analyze reconciles).
   =================================================================== */

let _wbData = null;   // last computed workbench model (for the Name… flow etc.)

function renderWorkbench(host, v, sess) {
  const wb = VocabMatch.buildWorkbench(sess.events, v);
  _wbData = wb;
  const cov = wb.coverage;
  const app = v.name || v.id || "this app";

  // Coverage header (Memo altitude — the ONE resident number). A calm sentence
  // carries it; the lists are Evidence, visible below (not hidden behind a
  // click) since the worklist IS the point of the surface.
  const headerNum = cov.totalControls
    ? cov.namedControls + " of " + cov.totalControls
    : "0 of 0";
  const covLine = cov.totalControls
    ? '<strong>' + headerNum + '</strong> captured controls named' +
      ' · <strong>' + cov.pctInteractions + '%</strong> of interactions'
    : 'No controls from this recording fall in ' + escapeHtml(app) + '’s scope yet';

  let html =
    '<div class="wb">' +
    '<div class="wb-coverage">' +
    '<div class="wb-coverage-line" id="wb-coverage-line">' + covLine + '</div>' +
    '<div class="wb-coverage-bar" title="' + cov.namedControls + ' of ' + cov.totalControls + ' distinct captured controls named">' +
    '<span class="wb-coverage-fill" style="width:' + (cov.totalControls ? cov.pctControls : 0) + '%"></span>' +
    '</div>' +
    '<div class="wb-coverage-sub meta">Measured against the loaded recording. ' +
    'Naming a control here edits the vocabulary in memory; ' +
    '<button type="button" class="link-btn" id="btn-wb-reanalyze">Re-analyze to apply names to this session</button>.</div>' +
    '</div>';

  // The three evidence lists.
  html += renderUnnamedList(wb.unnamed);
  html += renderMatchedList(wb.matched);
  html += renderDeadRulesList(wb.deadRules);
  html += renderScreensSection(wb.screens);

  // The rule editor (Machine layer) at the bottom.
  html += '<div id="vocab-machine-host"></div>';
  html += '</div>';
  host.innerHTML = html;

  renderRuleEditorDrawer($("#vocab-machine-host"), v);
  wireWorkbench();
}

function renderUnnamedList(unnamed) {
  const n = unnamed.length;
  let body;
  if (!n) {
    body = '<p class="wb-empty meta">Every captured control in scope has a name. Nothing to do here.</p>';
  } else {
    body = '<div class="wb-rows">' + unnamed.map(function (u, i) {
      const id = u.identity;
      const idChip = '<span class="wb-idkind" title="The strongest identity the recorder captured for this control">' +
        escapeHtml(id.kind === "unknown" ? "no id" : id.kind) + '</span>';
      const canName = !!u.addSignature;
      return '<div class="wb-row wb-row-unnamed" data-wb-unnamed="' + i + '">' +
        '<div class="wb-row-main">' +
        '<span class="wb-ct">' + escapeHtml(u.controlType || "control") + '</span>' +
        idChip +
        '<span class="wb-idval" title="What the recorder saw">' + escapeHtml(id.value) + '</span>' +
        '</div>' +
        '<div class="wb-row-meta meta">' + escapeHtml(u.window || "(no window title)") +
        ' · seen ' + u.count + '×</div>' +
        '<div class="wb-row-act">' +
        (canName
          ? '<button type="button" class="primary wb-name-btn" data-wb-name="' + i + '">Name…</button>'
          : '<span class="meta" title="No stable identity to key a rule on">no usable signature</span>') +
        '</div>' +
        '</div>';
    }).join("") + '</div>';
  }
  return wbListShell("unnamed", "Unnamed captured controls", n,
    "Controls this recording used that " + "no rule names yet — the worklist. Name the most-used first.",
    body, /*openByDefault*/ true);
}

function renderMatchedList(matched) {
  const n = matched.length;
  let body;
  if (!n) {
    body = '<p class="wb-empty meta">No captured control matched a rule in this vocabulary yet. ' +
      'Name a few from the worklist above, then re-analyze.</p>';
  } else {
    body = '<div class="wb-rows">' + matched.map(function (m, i) {
      const windows = (m.windows && m.windows.length ? m.windows : [m.window]).filter(Boolean);
      const values = (m.values || []).filter(Boolean);
      const evidence =
        '<div class="wb-evidence">' +
        '<div class="wb-ev-line"><span class="wb-ev-k">seen in</span> ' +
        (windows.length ? windows.map(function (w) { return '<span class="wb-ev-win">' + escapeHtml(w) + '</span>'; }).join(" ") : '<span class="meta">—</span>') +
        '</div>' +
        (values.length
          ? '<div class="wb-ev-line"><span class="wb-ev-k">example values</span> ' +
            values.map(function (x) { return '<code class="wb-ev-val">' + escapeHtml(x) + '</code>'; }).join(" ") + '</div>'
          : '') +
        '<div class="wb-ev-line"><span class="wb-ev-k">rule signature</span> ' +
        '<code class="wb-ev-sig">' + escapeHtml(sigSummary(m.signature)) + '</code></div>' +
        '</div>';
      return '<details class="wb-row wb-row-matched" data-wb-matched="' + i + '">' +
        '<summary class="wb-row-summary">' +
        '<span class="wb-match-name">' + escapeHtml(m.vocabName) + '</span>' +
        '<span class="wb-match-sigsum meta">' + escapeHtml(shortIdentity(m)) + '</span>' +
        '<span class="wb-match-count meta">seen ' + m.count + '×</span>' +
        '</summary>' + evidence +
        '</details>';
    }).join("") + '</div>';
  }
  return wbListShell("matched", "Matched controls", n,
    "Distinct captured controls a rule named — expand a row to check it against the evidence.",
    body, /*openByDefault*/ n > 0 && n <= 30);
}

function renderDeadRulesList(dead) {
  const n = dead.length;
  let body;
  if (!n) {
    body = '<p class="wb-empty meta">Every rule in this vocabulary matched at least one captured control. No dead rules.</p>';
  } else {
    body = '<div class="wb-rows">' + dead.map(function (d) {
      return '<div class="wb-row wb-row-dead">' +
        '<div class="wb-row-main">' +
        '<span class="wb-dead-name">' + escapeHtml(d.name) + '</span>' +
        '<code class="wb-ev-sig">' + escapeHtml(sigSummary(d.signature)) + '</code>' +
        '</div>' +
        '<div class="wb-row-meta meta">Matched nothing in this recording — the selector may be wrong, ' +
        'or this control just wasn’t used here.</div>' +
        '</div>';
    }).join("") + '</div>';
  }
  return wbListShell("dead", "Dead rules", n,
    "Rules that named nothing this recording — the “is my selector wrong?” list.",
    body, /*openByDefault*/ n > 0);
}

function renderScreensSection(screens) {
  const matched = screens.matched || [];
  const unnamed = screens.unnamed || [];
  const total = matched.length + unnamed.length;
  let body = '<div class="wb-screens">';
  if (matched.length) {
    body += '<div class="wb-screens-group"><div class="wb-screens-h meta">Named screens</div>' +
      matched.map(function (s) {
        return '<div class="wb-screen-row wb-screen-matched">' +
          '<span class="wb-screen-name">' + escapeHtml(s.screenName || s.screenId) + '</span>' +
          '<span class="wb-screen-title meta">' + escapeHtml(s.title) + '</span>' +
          '<span class="wb-screen-count meta">' + s.count + '×</span>' +
          '</div>';
      }).join("") + '</div>';
  }
  if (unnamed.length) {
    body += '<div class="wb-screens-group"><div class="wb-screens-h meta">Unnamed windows</div>' +
      unnamed.map(function (s, i) {
        return '<div class="wb-screen-row wb-screen-unnamed" data-wb-screen="' + i + '">' +
          '<span class="wb-screen-title">' + escapeHtml(s.title) + '</span>' +
          '<span class="wb-screen-count meta">' + s.count + '×</span>' +
          '<button type="button" class="wb-name-screen-btn" data-wb-name-screen="' + i + '">Name screen…</button>' +
          '</div>';
      }).join("") + '</div>';
  }
  if (!total) {
    body += '<p class="wb-empty meta">No windows observed for this app in the recording.</p>';
  }
  body += '</div>';
  return wbListShell("screens", "Screens", total,
    "Distinct windows seen in this recording, split into named vs. unnamed.",
    body, /*openByDefault*/ false);
}

/* A collapsible Evidence section shell with a count + one-line takeaway
   (Disclosure model: title + count resident, body expand-in-place). Uses a
   glyph-carrying summary with the native marker suppressed (avoids the doubled
   disclosure-marker pitfall). */
function wbListShell(key, title, count, takeaway, bodyHtml, openByDefault) {
  const persisted = State.getVocabState()._wbOpen && State.getVocabState()._wbOpen[key];
  const open = (persisted === undefined ? openByDefault : persisted);
  return '<details class="wb-list" data-wb-list="' + key + '"' + (open ? " open" : "") + '>' +
    '<summary class="wb-list-summary">' +
    '<span class="wb-list-chevron"></span>' +
    '<span class="wb-list-title">' + escapeHtml(title) + '</span>' +
    '<span class="wb-list-count">' + count + '</span>' +
    '<span class="wb-list-takeaway meta">' + escapeHtml(takeaway) + '</span>' +
    '</summary>' +
    '<div class="wb-list-body">' + bodyHtml + '</div>' +
    '</details>';
}

function sigSummary(sig) {
  sig = sig || {};
  const parts = [];
  if (sig.control_type) parts.push(sig.control_type);
  if (sig.automation_id) parts.push("aid=" + sig.automation_id);
  if (sig.name) parts.push("name=" + sig.name);
  if (sig.class_name) parts.push("class=" + sig.class_name);
  if (sig.framework_id) parts.push("fwk=" + sig.framework_id);
  if (sig.window_title_regex) parts.push("win~" + sig.window_title_regex);
  return parts.length ? parts.join(" · ") : "(empty signature)";
}

function shortIdentity(m) {
  const id = m.identity || {};
  if (id.kind === "automation_id") return "aid: " + id.value;
  if (id.kind === "name") return id.value;
  if (id.kind === "class_name") return "class: " + id.value;
  return id.value || m.controlType || "";
}

function wireWorkbench() {
  // Persist per-list open state (Disclosure rule 10: every disclosure remembers).
  document.querySelectorAll(".wb-list[data-wb-list]").forEach(function (det) {
    det.addEventListener("toggle", function () {
      const st = State.getVocabState();
      st._wbOpen = st._wbOpen || {};
      st._wbOpen[det.dataset.wbList] = det.open;
    });
  });
  document.querySelectorAll(".wb-name-btn[data-wb-name]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const i = parseInt(btn.dataset.wbName, 10);
      nameUnnamedControl(i);
    });
  });
  document.querySelectorAll(".wb-name-screen-btn[data-wb-name-screen]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      const i = parseInt(btn.dataset.wbNameScreen, 10);
      nameScreen(i);
    });
  });
  const re = $("#btn-wb-reanalyze");
  if (re) re.addEventListener("click", reanalyzeCurrentSession);
}

/* "Name…" on an UNNAMED row. Reuses the SAME add-from-interaction derivation
   the G-8 flow uses (signatureFromInteraction over the captured event), adds the
   row to the CURRENTLY-selected vocab (the workbench's whole point is one
   session × one vocab), opens the rule editor drawer with the fresh row focused,
   and lets the analyst type the business name + Save. Suggest-don't-mutate:
   nothing persists until the vocabulary's own Save. */
async function nameUnnamedControl(idx) {
  const wb = _wbData;
  const v = State.getVocabState().current;
  if (!wb || !v) return;
  const u = wb.unnamed[idx];
  if (!u) return;
  // Derive the signature from the ACTUAL captured interaction (G-8 derivation),
  // falling back to the list-built minimal signature.
  const signature = CA.signatureFromInteraction(u.sampleEvent) || u.addSignature;
  if (!signature) {
    toast("That control has no stable signature to key a rule on.", "error");
    return;
  }
  // Volatility-suspect ids: flag the way the discovery picker does — if the
  // automation_id looks auto-generated (a trailing render counter), warn the
  // analyst before keying a rule on it.
  if (signature.automation_id && looksVolatile(signature.automation_id)) {
    const ok = await confirmModal({
      title: "This id may change between runs",
      message: "The automation_id “" + signature.automation_id + "” looks auto-generated " +
        "(a per-render counter). A rule keyed on it may not match the next recording. " +
        "Add it anyway, or Cancel and key on the label instead?",
      okLabel: "Add anyway",
    });
    if (!ok) return;
  }
  v.interactions = v.interactions || [];
  const key = CA.vocabSignatureKey(signature);
  const dupIdx = v.interactions.findIndex(function (e) {
    return CA.vocabSignatureKey(e && e.signature) === key;
  });
  if (key && dupIdx >= 0) {
    openRuleEditorFocused(dupIdx);
    toast("This control is already a rule — highlighted it below.", "info");
    return;
  }
  const suggested = (u.identity && u.identity.kind === "name") ? u.identity.value : "";
  v.interactions.push({ signature: signature, name: suggested });
  markDirty();
  State.getVocabState()._ruleEditorOpen = true;
  // Re-render the workbench so the row leaves UNNAMED immediately (advisory), and
  // the rule editor drawer opens with the new row focused for naming.
  renderVocabEditor();
  openRuleEditorFocused(v.interactions.length - 1);
  toast("Added a rule for this control — type its business name, then Save the vocabulary.", "success");
}

/* Open the Machine-layer rule editor drawer and focus a specific interaction
   row's name field. */
function openRuleEditorFocused(idx) {
  const drawer = document.querySelector(".vocab-machine-drawer");
  if (drawer && !drawer.open) drawer.open = true;
  State.getVocabState()._ruleEditorOpen = true;
  _flashInteractionRow(idx);
}

/* Heuristic mirror of the discovery volatility flag: an id ending in a render
   counter (trailing digits after a hyphen/underscore, or a long hash) is
   suspect. Advisory only. */
function looksVolatile(aid) {
  const s = String(aid || "");
  return /[-_]\d{2,}$/.test(s) || /^[a-z]+-\d+$/i.test(s) || /[0-9a-f]{8,}/i.test(s);
}

/* "Name screen…" on an unnamed window. Suggests a window_title_regex by diffing
   the observed title variants of that screen (the volatile token becomes the
   wildcard; a single variant is escaped literally, and we say so). The analyst
   accepts/edits the suggestion; a screens entry is added to the current vocab
   (in memory, dirty — never auto-saved). */
async function nameScreen(idx) {
  const wb = _wbData;
  const v = State.getVocabState().current;
  const sess = State.getSession();
  if (!wb || !v || !sess) return;
  const s = wb.screens.unnamed[idx];
  if (!s) return;
  const name = await promptModal({
    title: "Name this screen",
    message: "Give this window a plain-English screen name (e.g., “New order”).",
    placeholder: "New order", okLabel: "Next",
  });
  if (!name) return;
  // Gather every observed title that shares this window's logical screen. For the
  // suggestion we diff the sibling variants: titles that share a long common
  // frame with the picked one. Cheap approach: use the picked title plus any
  // observed title with a >=6-char shared prefix OR suffix.
  const observed = collectObservedTitles(sess.events, v);
  const variants = siblingVariants(s.title, observed);
  const suggestion = VocabMatch.suggestScreenRegex(variants);
  const note = suggestion.single
    ? "Only one variant of this window was observed, so the title is matched literally. " +
      "If the window title carries a record number that changes per case, edit the pattern to replace it with .* ."
    : "Suggested by diffing the observed variants — the part that changed became a wildcard. Accept or edit.";
  const regex = await promptModal({
    title: "Window match pattern for “" + name + "”",
    message: note,
    defaultValue: suggestion.regex,
    placeholder: ".*" + name + ".*", okLabel: "Add screen",
  });
  if (!regex) return;
  v.screens = Array.isArray(v.screens) ? v.screens : [];
  const id = CA.slugify(name) || ("screen-" + (v.screens.length + 1));
  if (v.screens.some(function (x) { return x && x.id === id; })) {
    toast("A screen named “" + name + "” already exists in this vocabulary.", "info");
    return;
  }
  v.screens.push({ id: id, name: name, window_title_regex: regex });
  markDirty();
  renderVocabEditor();
  toast("Added screen “" + name + "” — review it in the rule editor and Save the vocabulary.", "success");
}

/* Every window title observed for this vocab's app (in scope), deduped. */
function collectObservedTitles(events, v) {
  const titles = new Set();
  for (const ev of (events || [])) {
    if (!ev || ev.type !== "interaction") continue;
    const d = ev.data || {};
    if (!VocabMatch.scopeMatches(v, d)) continue;
    if (d.window_title) titles.add(String(d.window_title));
  }
  return Array.from(titles);
}

/* Observed titles that plausibly belong to the SAME logical screen as `title`:
   they share a substantial common prefix or suffix with it. Always includes the
   picked title itself. */
function siblingVariants(title, observed) {
  const out = [title];
  for (const t of observed) {
    if (t === title) continue;
    const pre = VocabMatch.commonPrefix([title, t]).length;
    const suf = VocabMatch.commonSuffix([title, t], 0).length;
    if (pre >= 6 || suf >= 6) out.push(t);
  }
  return out;
}

/* Re-analyze the loaded session so authored names take effect. Reuses the
   existing "Analyze session" pipeline path (injected by the renderer) — NEVER
   auto-run; the analyst clicks the CTA. */
async function reanalyzeCurrentSession() {
  const sess = State.getSession();
  if (!sess) { toast("Open a session first.", "error"); return; }
  if (State.getVocabState().dirty) {
    toast("Save the vocabulary first, then re-analyze.", "error");
    return;
  }
  if (typeof onReanalyze !== "function") {
    toast("Re-analyze isn't available here — open the session and use Analyze session.", "error");
    return;
  }
  toast("Re-analyzing this session with the current vocabularies…");
  try { await onReanalyze(); } catch (e) { toast("Re-analyze failed: " + (e && e.message || e), "error"); return; }
  // The session reloaded; if the App Library tab is still visible, refresh the
  // workbench against the fresh data.
  renderVocabEditor();
}

/* Honest empty states (Disclosure replace-pattern). */
function renderNoVocabEmptyState(hasSession) {
  if (hasSession) {
    return '<div class="empty-pane">' +
      '<p><strong>Pick a vocabulary to match it against this recording.</strong></p>' +
      '<p class="meta">Choose an entry on the left to open the match workbench, or click ' +
      '<strong>+ New vocabulary</strong> to start one — then <strong>Start from a recording…</strong> ' +
      'fills it from what this session captured.</p>' +
      '</div>';
  }
  return '<div class="empty-pane">' +
    '<p><strong>Open a session, or pick a vocabulary, to begin.</strong></p>' +
    '<p class="meta">The match workbench matches a vocabulary against a loaded recording. ' +
    'Open a session on the <strong>Session</strong> tab, then pick a vocabulary here — or hand-edit ' +
    'the rules by selecting one on the left.</p>' +
    '</div>';
}

/* C2 checklist progress: "reviewed X / Y discovered". Hidden (with its
   Approve-all button) on a vocab with no discovered rows. */
function updateReviewProgress() {
  const prog = $("#vocab-review-progress");
  const btn = $("#btn-vocab-approve-all");
  const v = State.getVocabState().current;
  const discovered = ((v && v.interactions) || []).filter(isDiscoveredEntry);
  if (!prog) return;
  if (!discovered.length) {
    prog.textContent = "";
    prog.style.display = "none";
    if (btn) btn.style.display = "none";
    return;
  }
  const done = discovered.filter((e) => e._reviewed).length;
  prog.style.display = "";
  prog.textContent = "reviewed " + done + " / " + discovered.length + " discovered";
  prog.classList.toggle("all-done", done === discovered.length);
  if (btn) {
    btn.style.display = "";
    btn.disabled = done === discovered.length;
  }
}

function approveAllDiscovered() {
  const v = State.getVocabState().current;
  if (!v) return;
  for (const e of v.interactions || []) {
    if (isDiscoveredEntry(e)) e._reviewed = true;
  }
  renderVocabInteractions();
  updateReviewProgress();
}

function _buildVocabIntRow(ent, i) {
  const sig = ent.signature || {};
  // class_name is a real (if weak) signature dimension — include it so a
  // class_name-only entry reads as itself, not a blank "(unset signature)".
  const sigParts = [
    sig.control_type, sig.automation_id, sig.name,
    sig.class_name ? "class:" + sig.class_name : null,
  ].filter(Boolean);
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
  // ADR-0025 annotator context: WHAT the control is + WHERE it lives, captured
  // by discovery so a row carries meaning before it's named. Chips +
  // ancestry are discovery-meta (stripped on save).
  const chips = [];
  if (ent.role) chips.push('<span class="vocab-int-chip" title="UIA control role">' + escapeHtml(ent.role) + '</span>');
  if (ent.region) chips.push('<span class="vocab-int-chip" title="Where in the window the control sits">' + escapeHtml(ent.region) + '</span>');
  if (ent.framework) chips.push('<span class="vocab-int-chip" title="UI framework — sets how reliable the signature is">' + escapeHtml(ent.framework) + '</span>');
  const anc = Array.isArray(ent.ancestry) ? ent.ancestry.filter(Boolean) : [];
  const ancHtml = anc.length
    ? '<span class="vocab-int-anc" title="UIA ancestry (outermost → parent)">under ' + escapeHtml(anc.slice(-4).join(" › ")) + '</span>'
    : "";
  const context = (chips.length || ancHtml)
    ? '<div class="vocab-int-context">' + chips.join("") + ancHtml + '</div>'
    : "";
  // The volatility note: the per-render automation_id(s) the picker REJECTED
  // (changed across the two snapshot passes, or matched a volatility pattern),
  // which is why this entry is keyed on the label instead of the id.
  const vol = (Array.isArray(ent.volatile_aids) && ent.volatile_aids.length)
    ? '<div class="vocab-int-volatile" title="These automation_ids changed across snapshot passes or match a per-render pattern, so discovery keyed on the label instead.">⚠ volatile id rejected: ' +
      escapeHtml(ent.volatile_aids.join(", ")) + ' → keyed on label</div>'
    : "";
  // Honest weak-signature note (ADR-0023): a generic class_name with no stable id
  // or accessible name may not match reliably — say so and suggest the action,
  // rather than presenting an unreliable row as a confirmed control.
  const weak = (typeof ent.confidence === "number" && ent.confidence < 0.6)
    ? '<div class="vocab-int-weak-note">Weak signature — keyed on ' +
      escapeHtml(ent.identity_source || "a generic attribute") +
      ', with no stable id or accessible name. It may not match reliably; consider deleting it, or name it only if you recognise it.</div>'
    : "";
  // Over-merge transparency: when a weak signature collapsed several DISTINCT
  // controls (no label to tell them apart), list each one's context so the
  // analyst can name the right thing or split the bucket.
  const mem = Array.isArray(ent._members) ? ent._members : [];
  let members = "";
  if (mem.length > 1) {
    const total = (typeof ent.seen_count === "number" && ent.seen_count > mem.length) ? ent.seen_count : mem.length;
    const lis = mem.map((m) => {
      const bits = [
        m.role, m.region,
        (Array.isArray(m.under) && m.under.length) ? "under " + m.under.join(" › ") : null,
        m.name,
      ].filter(Boolean).map(escapeHtml).join(" · ");
      return '<li>' + (bits || "(no distinguishing context)") + '</li>';
    }).join("");
    members =
      '<details class="vocab-int-members"><summary>⚠ ' + total +
      ' distinct controls were merged here — review before naming</summary><ul>' + lis + '</ul></details>';
  }
  // C2: the discovery review checklist -- a discovered row renders an
  // explicit "reviewed" tick so the 10-minute pass is approve/edit per row,
  // not authoring into blank boxes. In-session aid only (stripped on save).
  const discovered = isDiscoveredEntry(ent);
  const review = discovered
    ? '<label class="vocab-int-review' + (ent._reviewed ? " done" : "") + '" ' +
      'title="Discovery pre-filled this row. Tick it once you\'ve checked or corrected it — a checklist aid; the tick itself isn\'t saved into the file.">' +
      '<input type="checkbox" data-review="1"' + (ent._reviewed ? " checked" : "") + '> reviewed</label>'
    : "";
  // C1 semantics strip: verb select + auto flags + the human/LLM columns.
  const verbVal = (ent.verb || "").trim();
  const verbOpts = ['<option value="">verb…</option>']
    .concat(VERBS.map((v) =>
      '<option value="' + v + '"' + (v === verbVal ? " selected" : "") + ">" + v + "</option>"));
  if (verbVal && VERBS.indexOf(verbVal) === -1) {
    verbOpts.push('<option value="' + escapeAttr(verbVal) + '" selected>' + escapeHtml(verbVal) + "</option>");
  }
  const flagTitles = {
    completion: "Pressing this finishes a piece of work (like Save, Submit or Send). We use it to know where one step ends and the next begins. Pre-ticked for Save/Submit/Send/OK buttons.",
    carries_value: "This field holds typed information. We use it to notice when the same data is re-typed into several apps. Pre-ticked for fields workers type into.",
    case_id_source: "What's typed here tells us which ticket, order or customer the work belongs to — it lets the app split a long recording into separate cases. Never pre-ticked; your judgment.",
  };
  const flagLabels = { completion: "'Done' action", carries_value: "Workers type data here", case_id_source: "Identifies the ticket/order" };
  const semantics =
    '<div class="vocab-int-semantics">' +
    '<label class="vocab-sem-verb" title="What using this control does — click, type, select or submit. Pre-filled automatically from the control type; change it if it&#39;s wrong.">' +
    '<span>Verb</span><select data-sem="verb">' + verbOpts.join("") + "</select></label>" +
    '<label title="The thing this control works on, in plain words — e.g. “customer record”. Always filled in by a person, never guessed.">' +
    '<span>Object</span><input type="text" data-sem="object" value="' + escapeAttr(ent.object || "") + '" placeholder="e.g., customer record"></label>' +
    '<label class="vocab-sem-means" title="One plain sentence on what this action does for the business. Always written by a person, never guessed.">' +
    '<span>Means</span><input type="text" data-sem="means" value="' + escapeAttr(ent.means || "") + '" placeholder="What does this do, in plain words? e.g. &#39;sends the order to billing&#39;"></label>' +
    '<span class="vocab-sem-flags">' +
    SEMANTIC_FLAG_FIELDS.map((f) =>
      '<label class="vocab-sem-flag" title="' + escapeAttr(flagTitles[f]) + '">' +
      '<input type="checkbox" data-semflag="' + f + '"' + (ent[f] === true ? " checked" : "") + "> " +
      flagLabels[f] + "</label>").join("") +
    "</span></div>";
  const row = document.createElement("div");
  row.className = "vocab-int" + (discovered && !ent._reviewed ? " vocab-int-unreviewed" : "");
  row.dataset.idx = String(i);
  row.innerHTML =
    '<div class="vocab-int-head">' +
    '<span class="vocab-int-num">' + (i + 1) + '</span>' +
    '<div class="vocab-int-sig">' + escapeHtml(sigSummary) + '</div>' +
    conf +
    seen +
    review +
    '<button class="icon-btn vocab-int-remove" title="Remove">✕</button>' +
    '</div>' +
    '<div class="vocab-int-body">' +
    context +
    vol +
    weak +
    members +
    '<label>Meaningful name<input type="text" data-field="name" value="' + escapeAttr(ent.name || "") + '" placeholder="e.g., Search customer record"></label>' +
    semantics +
    // Item 17: the raw signature inputs are Machine layer inside the card --
    // collapsed by default so they don't sit at equal weight with the
    // meaningful name + semantics strip. A DISCOVERED row auto-expands this
    // (the `open` attribute) so the §C2 review checklist -- which needs the
    // analyst to actually see/correct control_type / automation_id / etc. --
    // stays fully usable without an extra click.
    '<details class="vocab-int-sig-details"' + (discovered ? " open" : "") + '>' +
    '<summary>▸ Match signature</summary>' +
    '<div class="vocab-int-sig-fields">' +
    '<label>control_type<input type="text" data-sig="control_type" value="' + escapeAttr(sig.control_type || "") + '"></label>' +
    '<label>class_name<input type="text" data-sig="class_name" value="' + escapeAttr(sig.class_name || "") + '"></label>' +
    '<label>automation_id<input type="text" data-sig="automation_id" value="' + escapeAttr(sig.automation_id || "") + '"></label>' +
    '<label>name (raw)<input type="text" data-sig="name" value="' + escapeAttr(sig.name || "") + '"></label>' +
    '<label>window_title_regex<input type="text" data-sig="window_title_regex" value="' + escapeAttr(sig.window_title_regex || "") + '"></label>' +
    '</div>' +
    '</details>' +
    '</div>';
  row.querySelector(".vocab-int-remove").addEventListener("click", () => removeInteraction(i));
  const reviewBox = row.querySelector("[data-review]");
  if (reviewBox) reviewBox.addEventListener("change", () => {
    const v = State.getVocabState().current;
    const entRef = v && (v.interactions || [])[i];
    if (!entRef) return;
    if (reviewBox.checked) entRef._reviewed = true; else delete entRef._reviewed;
    row.classList.toggle("vocab-int-unreviewed", !reviewBox.checked);
    const lbl = row.querySelector(".vocab-int-review");
    if (lbl) lbl.classList.toggle("done", reviewBox.checked);
    updateReviewProgress();
  });
  row.querySelectorAll("[data-field], [data-sig], [data-flag], [data-sem], [data-semflag]").forEach((el) => {
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
   `signature` and `name` (plus, when supplied, the C1 `semantics` form
   state -- a non-empty field is set, an emptied/unchecked one is removed,
   and an absent `semantics` argument leaves prior semantic fields
   untouched, so pre-C1 callers keep their exact behavior); sets `flags`
   when any flag is checked and removes it otherwise (an entry with no
   flags carries no `flags` key). Pure -- exported for unit testing. */
function mergeVocabEntry(priorEntry, { signature, name, flags, semantics }) {
  const ent = { ...(priorEntry || {}) };
  ent.signature = signature || {};
  ent.name = name || "";
  if (flags && Object.keys(flags).length) ent.flags = flags;
  else delete ent.flags;
  if (semantics) {
    for (const k of ["verb"].concat(SEMANTIC_TEXT_FIELDS)) {
      const v = (semantics[k] || "").trim();
      if (v) ent[k] = v; else delete ent[k];
    }
    for (const k of SEMANTIC_FLAG_FIELDS) {
      if (semantics[k] === true) ent[k] = true; else delete ent[k];
    }
  }
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
    // C1 semantics form state (verb select, object/means text, the flags).
    const semantics = {};
    row.querySelectorAll("[data-sem]").forEach(el => {
      semantics[el.dataset.sem] = el.value;
    });
    row.querySelectorAll("[data-semflag]").forEach(el => {
      if (el.checked) semantics[el.dataset.semflag] = true;
    });
    const name = row.querySelector('[data-field="name"]').value.trim() || "";
    next.push(mergeVocabEntry(base, { signature: sig, name, flags, semantics }));
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
        "The recorder snapshots its live UI twice (a few seconds — up to ~a minute for a large app like a chat client) to find stable element signatures.",
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

/* ---- G-7: "Start from a recording" (per-app bootstrap) ----------------
   The arrival-session workflow: a received recording touches apps the analyst
   has no vocabulary for. This reads one starter skeleton per app from the
   recording's interactions and opens the chosen app's skeleton in the review
   checklist — every observed control pre-listed, names blank for the analyst.
   Nothing is saved until the analyst presses Save (suggest-don't-mutate).
   Building a vocabulary is an asset for when the SAME process is recorded
   again; it is never a prerequisite to READING a recording (Overview memo +
   findings + step groups stand alone). */
async function bootstrapFromSession() {
  const btn = $("#btn-vocab-bootstrap-session");
  const sess = State.getSession();
  const currentFolder = sess && sess.sessionFolder;
  if (btn) { btn.disabled = true; btn.textContent = "Reading the recording…"; }
  try {
    const r = await Ipc.bootstrapVocabsFromSession({ sessionFolder: currentFolder || null });
    if (r && r.cancelled) return;
    if (!r || !r.ok) {
      toast("Couldn't read the recording: " + ((r && r.error) || "unknown"), "error");
      return;
    }
    const apps = (r.apps || []).filter((a) => a && (a.interaction_count || 0) > 0);
    if (!apps.length) { toast("No app controls were found in that recording.", "error"); return; }
    const list = await Ipc.listAppVocabs();
    const existingById = new Map(((list && list.vocabs) || []).map((v) => [v.id, v]));
    const options = apps.map((a) => ({
      key: a.vocab_id,
      label: a.vocab_name + " — " + a.interaction_count + " control" + (a.interaction_count === 1 ? "" : "s"),
      hint: existingById.has(a.vocab_id)
        ? "already in your App Library — adds any new controls" : undefined,
    }));
    const chosenId = await pickerModal({
      title: "Start a vocabulary from this recording",
      message: "This recording used these apps. Pick one to start naming its controls — " +
        "every control we saw is filled in for you to review. Worth doing when you'll " +
        "record this process again; never needed just to read a recording.",
      options, okLabel: "Start naming",
    });
    if (!chosenId) return;
    const picked = apps.find((a) => a.vocab_id === chosenId);
    if (!picked) return;
    await openSkeletonForReview(picked.app_vocabulary, existingById.get(chosenId));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Start from a recording…"; }
  }
}

/* Load a bootstrapped skeleton into the editor for review. When a vocabulary
   for the app already exists, MERGE into it (analyst-named rows preserved, new
   controls added); otherwise create a new file and adopt the skeleton. Either
   way the new rows arrive as review-checklist rows (each carries the bootstrap
   `_hint`), dirty until the analyst Saves. */
async function openSkeletonForReview(skeleton, existing) {
  const sk = skeleton || {};
  if (existing && existing.path) {
    await selectVocab(existing.path);
    const v = State.getVocabState().current;
    if (!v) { toast("Couldn't open that App Library entry.", "error"); return; }
    const merged = mergeDiscoveredSkeleton(v, sk);
    State.getVocabState().current = merged.vocab;
    renderVocabEditor();
    markDirty();
    toast("Read " + (sk.interactions || []).length + " control(s) from the recording — " +
      merged.added + " new to name, " + merged.skipped + " already named. Review and Save.",
      "success");
    return;
  }
  // New app: create the file (the analyst chooses where), then adopt the
  // skeleton's scope + rows in memory for review.
  const p = await Ipc.newVocabFile({ suggestedId: sk.id || "new-app" });
  if (!p) return;
  await reloadVocabList();
  await selectVocab(p);
  const seed = State.getVocabState().current;
  if (!seed) { toast("Couldn't open the new App Library file.", "error"); return; }
  const merged = mergeDiscoveredSkeleton(seed, sk);
  merged.vocab.name = sk.name || merged.vocab.name;
  State.getVocabState().current = merged.vocab;
  renderVocabEditor();
  markDirty();
  toast("Started “" + (sk.name || "vocabulary") + "” from the recording — " +
    merged.added + " control(s) to name. Review each, then Save.", "success");
}

/* ---- G-8: "Add to App Library…" from a step interaction ---------------
   Right-clicking an interaction in the Steps detail offers this. It takes the
   interaction's signature (control_type + automation_id/name/class_name) and a
   label prefilled from the step name, lets the analyst choose or create the
   target vocabulary, and adds the row — dirty, for review, never auto-saved.
   Called by steps-view via the renderer (which switches to this tab first). */
async function addInteractionFromStep({ signature, suggestedName } = {}) {
  if (!signature) { toast("That interaction has no usable element signature to add.", "error"); return; }
  await reloadVocabList();
  const list = State.getVocabState().list || [];
  const options = list.map((v) => ({
    key: v.path,
    label: (v.name || v.id) + " — " + v.interaction_count + " control" + (v.interaction_count === 1 ? "" : "s"),
  }));
  options.push({ key: "__new__", label: "+ New vocabulary…" });
  const chosen = await pickerModal({
    title: "Add this control to a vocabulary",
    message: "Pick the app vocabulary this control belongs to (or start a new one). " +
      "The element signature is filled in and the name is taken from the step — " +
      "review it, then Save the vocabulary.",
    options, okLabel: "Add control",
  });
  if (!chosen) return;
  let targetPath = chosen;
  if (chosen === "__new__") {
    const name = await promptModal({
      title: "New App Library entry",
      message: "Which app is this control for?",
      placeholder: "e.g., Salesforce", okLabel: "Create",
    });
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    targetPath = await Ipc.newVocabFile({ suggestedId: id });
    if (!targetPath) return;
    await reloadVocabList();
    await selectVocab(targetPath);
    const v0 = State.getVocabState().current;
    if (v0) v0.name = name;
  } else {
    await selectVocab(targetPath);
  }
  const v = State.getVocabState().current;
  if (!v) { toast("Couldn't open that App Library entry.", "error"); return; }
  v.interactions = v.interactions || [];
  const key = CA.vocabSignatureKey(signature);
  const dupIdx = v.interactions.findIndex((e) => CA.vocabSignatureKey(e && e.signature) === key);
  if (key && dupIdx >= 0) {
    State.getVocabState()._ruleEditorOpen = true;
    renderVocabEditor();
    _flashInteractionRow(dupIdx);
    toast("This control is already in “" + (v.name || v.id) + "”. Highlighted it for you.", "info");
    return;
  }
  v.interactions.push({ signature, name: (suggestedName || "").trim() });
  // Open the rule editor drawer so the new row is visible/nameable even when the
  // workbench is the default surface (R2).
  State.getVocabState()._ruleEditorOpen = true;
  renderVocabEditor();
  markDirty();
  _flashInteractionRow(v.interactions.length - 1);
  toast("Added a control to “" + (v.name || v.id) + "” — give it a name and Save the vocabulary.", "success");
}

/* Scroll a freshly-added/duplicate interaction row into view + flash it. Opens
   the Machine-layer rule editor drawer first (it may be collapsed under the
   workbench). */
function _flashInteractionRow(idx) {
  const drawer = document.querySelector(".vocab-machine-drawer");
  if (drawer && !drawer.open) drawer.open = true;
  const host = $("#vocab-interactions");
  const row = host && host.querySelector('.vocab-int[data-idx="' + idx + '"]');
  if (!row) return;
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  row.classList.add("vocab-int-new");
  setTimeout(() => row.classList.remove("vocab-int-new"), 1500);
  const nameInput = row.querySelector('[data-field="name"]');
  if (nameInput) nameInput.focus();
}

/* ---- "Copy for LLM" + suggestions import (lab-phase §C3) -------------- */

/* Copy-for-LLM from the App Library: the SELECTED vocab as skeleton rows
   (signatures + auto-semantics + value-free titles). Authoring-time,
   consultant-side; the export modal shows the exact artifact for
   line-by-line review before anything is copied. */
function copyVocabForLlm() {
  const v = State.getVocabState().current;
  if (!v) { toast("Pick a vocabulary on the left first.", "error"); return; }
  LlmExport.showExportModal({
    vocabs: [v],
    posture: Posture.getDataPosture(),
    surface: "app-library",
  });
}

/* Multiline paste modal (promptModal is single-line). Resolves to the
   pasted text or null. */
function _pasteSuggestionsModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal llm-export-modal">' +
      '<header class="modal-header"><h2>Import AI suggestions</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      '<p class="modal-msg">Paste the reply text the AI returned (the <code>{ "suggestions": { "&lt;row_key&gt;": { name / object / means } } }</code> shape from the export\'s instructions). ' +
      "Nothing is applied yet — next you approve each suggestion row by row.</p>" +
      '<textarea class="llm-export-text" spellcheck="false" placeholder="{\n  &quot;suggestions&quot;: { … }\n}"></textarea>' +
      "</div>" +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">Cancel</button>' +
      '<button class="primary llm-import-next">Review suggestions…</button>' +
      "</footer></div>";
    document.body.appendChild(backdrop);
    const ta = backdrop.querySelector("textarea");
    let resolved = false;
    function done(val) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(val);
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(null); } }
    document.addEventListener("keydown", onKey, true);
    backdrop.querySelector(".modal-close").addEventListener("click", () => done(null));
    backdrop.querySelector(".modal-cancel").addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(null); });
    backdrop.querySelector(".llm-import-next").addEventListener("click", () => done(ta.value));
    setTimeout(() => ta.focus(), 0);
  });
}

/* Import path (§C3): paste -> parse -> per-row approval checklist ->
   apply ONLY the approved rows onto the in-memory vocab (dirty; the
   analyst still presses Save). Suggest-don't-mutate end to end. */
async function importLlmSuggestions() {
  const v = State.getVocabState().current;
  if (!v) { toast("Pick the vocabulary the suggestions belong to first.", "error"); return; }
  const text = await _pasteSuggestionsModal();
  if (!text || !text.trim()) return;
  const parsed = LlmExport.parseSuggestions(text);
  if (!parsed.suggestions) { toast(parsed.error, "error"); return; }
  const m = LlmExport.matchSuggestions(v, parsed.suggestions);
  if (!m.rows.length) {
    const extra = [];
    if ((m.otherVocab || []).length) {
      extra.push(m.otherVocab.length + " row(s) belong to a different app's " +
        "entry — pick that app in the list and import again");
    }
    if (m.unmatched.length) extra.push(m.unmatched.length + " unknown row_key(s)");
    toast("No suggestions matched this vocabulary's rows" +
      (extra.length ? " (" + extra.join("; ") + ")" : "") +
      " — nothing to apply.", "error");
    return;
  }
  const items = m.rows.map((r) => {
    const cur = r.current.name || "(unnamed row)";
    const parts = [];
    if (r.proposed.name) parts.push("name → “" + r.proposed.name + "”");
    if (r.proposed.object) parts.push("object → “" + r.proposed.object + "”");
    if (r.proposed.means) parts.push("means → “" + r.proposed.means + "”");
    return { key: r.key, label: cur + ":  " + parts.join("  ·  "), checked: false };
  });
  const picked = await checklistModal({
    title: "Apply AI suggestions? (" + m.rows.length + " row" + (m.rows.length === 1 ? "" : "s") + ")",
    message: "Nothing applies without your approval — tick the rows to accept" +
      (m.unmatched.length ? " (" + m.unmatched.length + " suggestion(s) named unknown rows and were ignored)" : "") +
      ". Applying marks the vocabulary dirty; Save persists it.",
    items, selectAll: true, okLabel: "Apply selected",
  });
  if (!picked) return;
  const approvedKeys = Object.keys(picked).filter((k) => picked[k]);
  if (!approvedKeys.length) { toast("No rows approved — nothing applied.", "info"); return; }
  const applied = LlmExport.applySuggestionsToVocab(v, m.rows, approvedKeys);
  renderVocabEditor();
  markDirty();
  toast("Applied " + applied + " suggestion(s) — review and Save vocabulary.", "success");
}

/* The two §C3 buttons live in the App Library toolbar ONLY while the data
   posture allows them: `sealed` REMOVES them from the DOM (§C4) — the
   egress promise is enforced by code, not by a disabled button. */
function renderVocabLlmButtons() {
  const copyOld = $("#btn-vocab-copy-llm");
  const importOld = $("#btn-vocab-import-llm");
  if (copyOld) copyOld.remove();
  if (importOld) importOld.remove();
  if (!Posture.copyForLlmAllowed()) return;
  // Item 18: anchor on the dedicated marker span, not #btn-vocab-reload --
  // that button now lives inside the "⋯ More" overflow popup, while these
  // two stay resident primary actions in the main toolbar.
  const anchor = $("#vocab-llm-anchor");
  if (!anchor || !anchor.parentNode) return;
  const copyBtn = document.createElement("button");
  copyBtn.id = "btn-vocab-copy-llm";
  copyBtn.textContent = "Copy for AI review…";
  copyBtn.title = "Build a privacy-masked text summary of the selected app's rows to paste into an AI chat for naming suggestions. You review it line by line first; data sharing mode: " + Posture.getDataPosture() + ".";
  copyBtn.addEventListener("click", copyVocabForLlm);
  const importBtn = document.createElement("button");
  importBtn.id = "btn-vocab-import-llm";
  importBtn.textContent = "Import suggestions…";
  importBtn.title = "Paste the AI's suggestions back — shown as a per-row approval checklist; nothing is applied without your tick.";
  importBtn.addEventListener("click", importLlmSuggestions);
  anchor.parentNode.insertBefore(copyBtn, anchor);
  anchor.parentNode.insertBefore(importBtn, anchor);
}

/* Wire the App Library tab controls. Call once at boot. `deps.onReanalyze` is
   the renderer's re-run-the-pipeline path (the existing "Analyze session"
   flow), used by the workbench's "Re-analyze to apply names" CTA. */
function initVocabView(deps) {
  if (deps && typeof deps.onReanalyze === "function") onReanalyze = deps.onReanalyze;
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
  if ($("#btn-vocab-bootstrap-session")) {
    $("#btn-vocab-bootstrap-session").addEventListener("click", bootstrapFromSession);
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
  // §C3/§C4: the LLM buttons exist only under a permitting posture, and
  // appear/disappear live when the posture changes (Overview header select).
  renderVocabLlmButtons();
  Posture.onPostureChange(renderVocabLlmButtons);
}

module.exports = {
  initVocabView, reloadVocabList, mergeVocabEntry,
  mergeDiscoveredSkeleton, mergeScreens, stripDiscoveryMeta,
  isDiscoveredEntry, renderVocabLlmButtons,
  bootstrapFromSession, addInteractionFromStep,
  // R2 workbench helpers (exported for unit testing).
  siblingVariants, looksVolatile,
};
