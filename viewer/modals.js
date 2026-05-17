/*
 * modals.js -- themed, promise-based replacements for window.prompt
 * and window.confirm.
 *
 * Electron's renderer ships without a working prompt() implementation;
 * calling it silently returns undefined, which is why "Add manual step"
 * and "Group into phase" felt broken. promptModal() is a real inline
 * modal that resolves to the typed string (or null on cancel/escape).
 *
 * Browser-native confirm() dialogs look unstyled against the app theme
 * and corp users find them indistinguishable from a phishing popup.
 * confirmModal() takes the same structural opts and resolves true/false;
 * a `danger` flag styles the primary action red for destructive ops.
 */

"use strict";

const { escapeHtml, escapeAttr } = require("./dom.js");

function promptModal(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-prompt";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Input") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      (opts.multiline
        ? '<textarea class="modal-input modal-textarea" placeholder="' +
          escapeAttr(opts.placeholder || "") + '">' +
          escapeHtml(opts.defaultValue || "") + '</textarea>'
        : '<input type="text" class="modal-input"' +
          ' placeholder="' + escapeAttr(opts.placeholder || "") + '"' +
          ' value="' + escapeAttr(opts.defaultValue || "") + '">') +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="primary modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector(".modal-input");
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      resolve(value);
    }
    okBtn.addEventListener("click", () => done(input.value));
    cancelBtn.addEventListener("click", () => done(null));
    closeBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !opts.multiline) { e.preventDefault(); done(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

function confirmModal(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-confirm";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    const okClass = opts.danger ? "danger" : "primary";
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Confirm") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="' + okClass + ' modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      else if (e.key === "Escape") { e.preventDefault(); done(false); }
    }
    okBtn.addEventListener("click", () => done(true));
    cancelBtn.addEventListener("click", () => done(false));
    closeBtn.addEventListener("click", () => done(false));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(false);
    });
    document.addEventListener("keydown", onKey);
    // Focus the default action so Enter/Space confirms.
    setTimeout(() => { (opts.danger ? cancelBtn : okBtn).focus(); }, 0);
  });
}

/* Multi-field variant of promptModal. `fields` is an array of
   { key, label, value, placeholder, hint, options[] }; resolves to an
   object of key->value, or null on cancel/escape. */
function formModal(opts) {
  opts = opts || {};
  const fields = Array.isArray(opts.fields) ? opts.fields : [];
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-prompt";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    const fieldsHtml = fields.map((f, i) => {
      const choices = Array.isArray(f.options) ? f.options : [];
      const listId = choices.length ? ("modal-form-list-" + i) : "";
      const datalist = listId
        ? '<datalist id="' + listId + '">' +
          choices.map((o) => '<option value="' + escapeAttr(String(o)) + '"></option>').join("") +
          '</datalist>'
        : "";
      return '<label class="modal-field"><span>' + escapeHtml(f.label || f.key || "") + '</span>' +
        (f.hint ? '<small class="modal-field-hint">' + escapeHtml(f.hint) + '</small>' : "") +
        '<input type="text" class="modal-input" data-key="' + escapeAttr(f.key || "") + '"' +
        (listId ? ' list="' + listId + '"' : "") +
        ' placeholder="' + escapeAttr(f.placeholder || "") + '"' +
        ' value="' + escapeAttr(f.value || "") + '"></label>' + datalist;
    }).join("");
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Input") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : "") +
      fieldsHtml +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="primary modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const inputs = Array.from(backdrop.querySelectorAll(".modal-input"));
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    }
    function collect() {
      const out = {};
      inputs.forEach((inp) => { out[inp.dataset.key] = inp.value; });
      return out;
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); done(collect()); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    }
    okBtn.addEventListener("click", () => done(collect()));
    cancelBtn.addEventListener("click", () => done(null));
    closeBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(null); });
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => { if (inputs[0]) { inputs[0].focus(); inputs[0].select(); } }, 0);
  });
}

/* A modal with a list of checkboxes. `items` is an array of
   { key, label, hint, checked, disabled }; resolves to an object of
   key->bool, or null on cancel/escape. Used by the findings-report
   export to pick which optional sections to include. */
function checklistModal(opts) {
  opts = opts || {};
  const items = Array.isArray(opts.items) ? opts.items : [];
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-prompt";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    const rows = items.map((it) =>
      '<label class="modal-check' + (it.disabled ? " disabled" : "") + '">' +
      '<input type="checkbox" data-key="' + escapeAttr(it.key || "") + '"' +
      (it.checked ? " checked" : "") + (it.disabled ? " disabled" : "") + ">" +
      "<span>" + escapeHtml(it.label || it.key || "") + "</span>" +
      (it.hint ? '<small>' + escapeHtml(it.hint) + "</small>" : "") +
      "</label>").join("");
    backdrop.innerHTML =
      '<div class="modal modal-sm">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Options") + "</h2>" +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + "</p>" : "") +
      rows +
      "</div>" +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + "</button>" +
      '<button class="primary modal-ok">' + escapeHtml(okLabel) + "</button>" +
      "</footer></div>";
    document.body.appendChild(backdrop);
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    function collect() {
      const out = {};
      backdrop.querySelectorAll("input[type=checkbox]").forEach((c) => {
        out[c.dataset.key] = c.checked;
      });
      return out;
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); done(collect()); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    }
    okBtn.addEventListener("click", () => done(collect()));
    cancelBtn.addEventListener("click", () => done(null));
    closeBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(null); });
    document.addEventListener("keydown", onKey);
    setTimeout(() => { okBtn.focus(); }, 0);
  });
}

module.exports = { promptModal, confirmModal, formModal, checklistModal };
