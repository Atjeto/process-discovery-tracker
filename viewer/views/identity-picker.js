/*
 * identity-picker.js -- the per-step "Match rules" picker for the
 * Process Template tab.
 *
 * A modal that composes a template step's match rules from three
 * sources: the App Library (the catalog of named UI interactions), a
 * hand-typed coarse app/window rule, or an interaction lifted from a
 * captured session. Library-sourced rules are stored hybrid
 * (library_ref + cached literal -- see canonical-author.js); a derived
 * rule can be filed back into the App Library (§5).
 *
 * openIdentityPicker(step) resolves to the new match-rule array, or
 * null if the analyst cancels.
 */

"use strict";

const { escapeHtml, toast } = require("../dom.js");
const { promptModal, confirmModal, formModal } = require("../modals.js");
const Ipc = require("../ipc.js");
const CA = require("../canonical-author.js");

/* Load every App Library vocabulary as a full object, each tagged with
   its file path (needed to write merges back). */
async function loadVocabs() {
  const list = await Ipc.listAppVocabs();
  const out = [];
  for (const s of ((list && list.vocabs) || [])) {
    const v = await Ipc.readVocab(s.path);
    if (v && !v._error) { v._path = s.path; out.push(v); }
  }
  return out;
}

/* Distinct interactions observed in a session, deduped by signature
   key and frequency-ranked. */
function distinctSessionInteractions(session) {
  const seen = new Map();
  for (const ev of ((session && session.events) || [])) {
    if (!ev || ev.type !== "interaction") continue;
    const sig = CA.signatureFromInteraction(ev);
    const key = sig && CA.vocabSignatureKey(sig);
    if (!key) continue;
    const cur = seen.get(key);
    if (cur) { cur.count++; continue; }
    const d = ev.data || {};
    seen.set(key, {
      signature: sig,
      label: d.name || d.automation_id || d.control_type || "(interaction)",
      process: d.process_name || "",
      count: 1,
    });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

function ruleOrigin(rule) {
  if (rule && rule.library_ref) return "library";
  if (rule && rule.interaction) return "derived";
  return "coarse";
}

function ruleSummary(rule) {
  const parts = [];
  if (rule.process_name) parts.push(escapeHtml(rule.process_name));
  if (rule.window_title_regex) parts.push("title ~ " + escapeHtml(rule.window_title_regex));
  const i = rule.interaction || {};
  for (const k of ["control_type", "automation_id", "name"]) {
    if (i[k]) parts.push(escapeHtml(i[k]));
  }
  return parts.join(" · ") || "(empty rule)";
}

/* Build a match rule from a session's distinct-interaction item;
   auto-link it to the App Library when recognizeRule finds a hit. */
function sessionItemToRule(item, vocabs) {
  const rule = {};
  if (item.process) rule.process_name = item.process;
  const interaction = {};
  for (const k of ["control_type", "automation_id", "name"]) {
    if (item.signature[k]) interaction[k] = item.signature[k];
  }
  if (Object.keys(interaction).length) rule.interaction = interaction;
  const ref = CA.recognizeRule(rule, vocabs);
  if (ref) rule.library_ref = ref;
  return rule;
}

/* §5 -- file a derived rule's interaction into an App Library vocab,
   merging (signature-deduped) into an existing vocab or creating a
   partial one. Returns a library_ref, or null if the analyst cancels. */
async function fileRuleIntoLibrary(rule, vocabs) {
  if (!rule.interaction) {
    toast("A basic match rule has no UI element to catalogue.", "error");
    return null;
  }
  const name = await promptModal({
    title: "Add to App Library",
    message: "Plain-English name for this interaction",
    placeholder: "e.g. Customer search field",
    okLabel: "Continue",
  });
  if (!name) return null;
  const proc = rule.process_name || "";
  const candidates = proc
    ? vocabs.filter((v) => (v.scope || {}).process_name === proc)
    : [];
  const entry = { signature: Object.assign({}, rule.interaction), name };

  if (candidates.length) {
    let chosen = candidates[0];
    if (candidates.length > 1) {
      const r = await formModal({
        title: "Add to App Library",
        message: "Which App Library entry should this go into?",
        fields: [{
          key: "vocab", label: "App Library entry",
          value: candidates[0].name || candidates[0].id,
          options: candidates.map((v) => v.name || v.id),
        }],
      });
      if (!r) return null;
      chosen = candidates.find((v) => (v.name || v.id) === r.vocab) || candidates[0];
    }
    const merged = CA.mergeInteractionsIntoVocab(chosen, [entry]);
    const w = await Ipc.writeVocab({ path: chosen._path, vocab: merged.vocab });
    if (!w || !w.ok) { toast("Couldn't write the App Library file", "error"); return null; }
    toast(merged.added ? "Added to " + (chosen.name || chosen.id)
      : "Already in " + (chosen.name || chosen.id), "success");
    return { vocab_id: chosen.id, interaction: name };
  }

  const ok = await confirmModal({
    title: "New App Library entry",
    message: "No App Library entry exists for " + (proc || "this app") + ". Create one?",
    okLabel: "Create",
  });
  if (!ok) return null;
  const vocabName = await promptModal({
    title: "New App Library entry",
    message: "Name the app this entry is for",
    placeholder: "e.g. Salesforce",
    okLabel: "Create",
  });
  if (!vocabName) return null;
  const id = CA.slugify(vocabName) || "app";
  const path = await Ipc.newVocabFile({ suggestedId: id });
  if (!path) return null;
  const vocab = {
    id, name: vocabName, version: 1,
    scope: proc ? { process_name: proc } : {},
    interactions: [entry],
  };
  const w = await Ipc.writeVocab({ path, vocab });
  if (!w || !w.ok) { toast("Couldn't write the App Library file", "error"); return null; }
  toast("Created App Library entry “" + vocabName + "”", "success");
  return { vocab_id: id, interaction: name };
}

function openIdentityPicker(step) {
  return new Promise((resolve) => {
    const working = JSON.parse(JSON.stringify((step && step.match) || []));
    let vocabs = [];
    let source = "library";       // "library" | "session"
    let sessionItems = null;
    let sessionLabel = "";
    let coarseOpen = false;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal modal-simple ident-picker">' +
        '<header class="modal-header"><h2>Match rules — ' +
          escapeHtml((step && step.name) || "step") + '</h2>' +
          '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
        '<div class="modal-body ident-body">' +
          '<div class="ident-section-title">This step’s identity</div>' +
          '<div id="ident-rules" class="ident-rules"></div>' +
          '<div class="ident-add-actions">' +
            '<button id="ident-add-coarse" type="button">+ Basic match rule</button>' +
            '<button id="ident-add-session" type="button">+ From a session…</button>' +
          '</div>' +
          '<div id="ident-coarse" class="ident-coarse" style="display:none">' +
            '<input type="text" id="ident-coarse-proc" class="modal-input" placeholder="process_name (e.g. chrome.exe)">' +
            '<input type="text" id="ident-coarse-title" class="modal-input" placeholder="window_title_regex (e.g. .*Salesforce.*)">' +
            '<button id="ident-coarse-add" class="primary" type="button">Add rule</button>' +
          '</div>' +
          '<div class="ident-section-title" id="ident-cat-title">Add from the App Library</div>' +
          '<input type="search" id="ident-search" class="modal-input" placeholder="Filter interactions...">' +
          '<div id="ident-catalog" class="ident-catalog"></div>' +
        '</div>' +
        '<footer class="modal-footer">' +
          '<button class="modal-cancel">Cancel</button>' +
          '<button class="primary modal-ok">Apply</button>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);

    const rulesHost = backdrop.querySelector("#ident-rules");
    const catHost = backdrop.querySelector("#ident-catalog");
    const catTitle = backdrop.querySelector("#ident-cat-title");
    const searchEl = backdrop.querySelector("#ident-search");
    const coarseEl = backdrop.querySelector("#ident-coarse");

    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); done(null); }
    }

    function hasRuleWithRef(vocabId, interactionName) {
      return working.some((r) => r.library_ref &&
        r.library_ref.vocab_id === vocabId && r.library_ref.interaction === interactionName);
    }

    function renderRules() {
      if (!working.length) {
        rulesHost.innerHTML = '<p class="ident-empty">No rules yet — this step won’t auto-match. ' +
          'Add one from the App Library below, a basic match rule, or a session.</p>';
        return;
      }
      rulesHost.innerHTML = "";
      working.forEach((rule, idx) => {
        const origin = ruleOrigin(rule);
        const originLabel = origin === "coarse" ? "basic" : origin;
        const drift = origin === "library" && CA.ruleDrift(rule, vocabs);
        const row = document.createElement("div");
        row.className = "ident-rule";
        row.innerHTML =
          '<span class="ident-rule-origin origin-' + origin + '">' + originLabel + '</span>' +
          '<span class="ident-rule-summary">' + ruleSummary(rule) + '</span>' +
          (drift ? '<span class="ident-drift" title="The linked App Library entry changed since this rule was cached">drift</span>' : '') +
          (drift ? '<button class="ident-rule-resync" type="button">re-sync</button>' : '') +
          (origin === "derived" ? '<button class="ident-rule-file" type="button">+ App Library</button>' : '') +
          '<button class="ident-rule-del" type="button" title="Remove">✕</button>';
        row.querySelector(".ident-rule-del").addEventListener("click", () => {
          working.splice(idx, 1);
          renderRules(); renderCatalog();
        });
        const fileBtn = row.querySelector(".ident-rule-file");
        if (fileBtn) fileBtn.addEventListener("click", async () => {
          const ref = await fileRuleIntoLibrary(rule, vocabs);
          if (ref) {
            rule.library_ref = ref;
            vocabs = await loadVocabs();
            renderRules(); renderCatalog();
          }
        });
        const resyncBtn = row.querySelector(".ident-rule-resync");
        if (resyncBtn) resyncBtn.addEventListener("click", () => {
          const ref = rule.library_ref || {};
          const v = vocabs.find((x) => x.id === ref.vocab_id);
          const entry = v && (v.interactions || []).find((e) => e && e.name === ref.interaction);
          if (v && entry) { working[idx] = CA.vocabInteractionToRule(v, entry); renderRules(); }
        });
        rulesHost.appendChild(row);
      });
    }

    function renderCatalog() {
      const q = (searchEl.value || "").toLowerCase();
      let html = "";
      const rowFns = [];
      if (source === "library") {
        catTitle.textContent = "Add from the App Library";
        const items = [];
        for (const v of vocabs) {
          for (const entry of (v.interactions || [])) {
            if (entry && entry.name) items.push({ v, entry });
          }
        }
        if (!items.length) {
          catHost.innerHTML = '<p class="ident-empty">No named App Library interactions yet — ' +
            'build one on the App Library tab, or use a basic match rule or a session.</p>';
          return;
        }
        items.forEach(({ v, entry }) => {
          const label = (v.name || v.id) + " ▸ " + entry.name;
          if (q && !label.toLowerCase().includes(q)) return;
          const already = hasRuleWithRef(v.id, entry.name);
          const strong = !!(entry.signature || {}).automation_id;
          html += '<button type="button" class="ident-cat-row" data-i="' + rowFns.length + '"' +
            (already ? " disabled" : "") + '>' +
            '<span class="ident-cat-label">' + escapeHtml(label) + '</span>' +
            '<span class="ident-cat-strength ' + (strong ? "strong" : "weak") + '">' +
              (strong ? "strong" : "weak") + '</span>' +
            (already ? '<span class="ident-cat-added">✓ added</span>' : '') +
            '</button>';
          rowFns.push(() => {
            const rule = CA.vocabInteractionToRule(v, entry);
            if (rule) { working.push(rule); renderRules(); renderCatalog(); }
          });
        });
        if (!html) html = '<p class="ident-empty">No interactions match the filter.</p>';
      } else {
        catTitle.textContent = "Add from session — " + sessionLabel;
        html += '<button type="button" class="ident-cat-back" data-back="1">‹ Back to the App Library</button>';
        const items = sessionItems || [];
        if (!items.length) {
          html += '<p class="ident-empty">No interactions found in that session.</p>';
        } else {
          let shown = 0;
          items.forEach((item) => {
            const label = item.label + (item.process ? "  (" + item.process + ")" : "");
            if (q && !label.toLowerCase().includes(q)) return;
            shown++;
            html += '<button type="button" class="ident-cat-row" data-i="' + rowFns.length + '">' +
              '<span class="ident-cat-label">' + escapeHtml(label) + '</span>' +
              '<span class="ident-cat-strength">seen ' + item.count + '×</span>' +
              '</button>';
            rowFns.push(() => {
              working.push(sessionItemToRule(item, vocabs));
              renderRules(); renderCatalog();
            });
          });
          if (!shown) html += '<p class="ident-empty">No interactions match the filter.</p>';
        }
      }
      catHost.innerHTML = html;
      catHost.querySelectorAll(".ident-cat-row").forEach((el) => {
        const fn = rowFns[parseInt(el.dataset.i, 10)];
        if (fn) el.addEventListener("click", fn);
      });
      const backEl = catHost.querySelector(".ident-cat-back");
      if (backEl) backEl.addEventListener("click", () => { source = "library"; renderCatalog(); });
    }

    backdrop.querySelector(".modal-close").addEventListener("click", () => done(null));
    backdrop.querySelector(".modal-cancel").addEventListener("click", () => done(null));
    backdrop.querySelector(".modal-ok").addEventListener("click", () => done(working));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(null); });
    document.addEventListener("keydown", onKey);
    searchEl.addEventListener("input", renderCatalog);

    backdrop.querySelector("#ident-add-coarse").addEventListener("click", () => {
      coarseOpen = !coarseOpen;
      coarseEl.style.display = coarseOpen ? "" : "none";
    });
    backdrop.querySelector("#ident-coarse-add").addEventListener("click", () => {
      const procEl = backdrop.querySelector("#ident-coarse-proc");
      const titleEl = backdrop.querySelector("#ident-coarse-title");
      const proc = procEl.value.trim();
      const title = titleEl.value.trim();
      if (!proc && !title) { toast("Enter a process name or a window-title regex", "error"); return; }
      const rule = {};
      if (proc) rule.process_name = proc;
      if (title) rule.window_title_regex = title;
      working.push(rule);
      procEl.value = ""; titleEl.value = "";
      coarseOpen = false; coarseEl.style.display = "none";
      renderRules();
    });

    backdrop.querySelector("#ident-add-session").addEventListener("click", async () => {
      const folder = await Ipc.openSessionFolder();
      if (!folder) return;
      const session = await Ipc.loadSession(folder);
      if (!session || session.error) { toast("Couldn't load that session", "error"); return; }
      sessionItems = distinctSessionInteractions(session);
      sessionLabel = folder.split(/[\\/]/).pop() || "session";
      source = "session";
      searchEl.value = "";
      renderCatalog();
    });

    renderRules();
    catHost.innerHTML = '<p class="ident-empty">Loading the App Library…</p>';
    loadVocabs().then((v) => {
      vocabs = v;
      renderRules();
      renderCatalog();
    }).catch(() => {
      catHost.innerHTML = '<p class="ident-empty">Couldn’t load the App Library.</p>';
    });
  });
}

module.exports = { openIdentityPicker, loadVocabs };
