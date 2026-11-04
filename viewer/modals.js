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
    // opts.required (lane HV): OK waits for some text.
    const blank = () => !!opts.required && !String(input.value).trim();
    const syncOk = () => { okBtn.disabled = blank(); };
    if (opts.required) { input.addEventListener("input", syncOk); syncOk(); }
    okBtn.addEventListener("click", () => { if (!blank()) done(input.value); });
    cancelBtn.addEventListener("click", () => done(null));
    closeBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !opts.multiline) { e.preventDefault(); if (!blank()) done(input.value); }
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

/* A choice from a list (2.0.5, Place after a step...): opts { title,
   message, detail, groups: [{ label, items: [{ value, label, title }] }],
   value (the item chosen at first), okLabel }. A list box shows the items
   under their groups' labels; Enter or a double-click chooses, Escape
   cancels. Resolves to the value chosen, or null. */
function chooseModal(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const groups = (opts.groups || []).filter((g) => g && (g.items || []).length);
    const count = groups.reduce((n, g) => n + 1 + g.items.length, 0);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop modal-choose";
    const okLabel = opts.okLabel || "OK";
    const cancelLabel = opts.cancelLabel || "Cancel";
    const option = (it) => '<option value="' + escapeAttr(it.value) + '"' + (it.title ? ' title="' + escapeAttr(it.title) + '"' : "") +
      (it.value === opts.value ? " selected" : "") + ">" + escapeHtml(it.label) + "</option>";
    backdrop.innerHTML =
      '<div class="modal modal-sm" role="dialog" aria-label="' + escapeAttr(opts.title || "Choose") + '">' +
      '<header class="modal-header"><h2>' + escapeHtml(opts.title || "Choose") + '</h2>' +
      '<button class="icon-btn modal-close" title="Cancel (Esc)">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      '<select class="modal-input modal-list" size="' + Math.max(4, Math.min(12, count)) + '" aria-label="' +
        escapeAttr(opts.listLabel || opts.title || "Choose") + '">' +
        groups.map((g) => '<optgroup label="' + escapeAttr(g.label) + '">' + g.items.map(option).join("") + "</optgroup>").join("") +
      "</select>" +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      '</div>' +
      '<footer class="modal-footer">' +
      '<button class="modal-cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button class="primary modal-ok">' + escapeHtml(okLabel) + '</button>' +
      '</footer>' +
      '</div>';
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector(".modal-list");
    const okBtn = backdrop.querySelector(".modal-ok");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      resolve(value);
    }
    const chosen = () => (list.value ? list.value : null);
    const syncOk = () => { okBtn.disabled = !chosen(); };
    list.addEventListener("change", syncOk);
    syncOk();
    okBtn.addEventListener("click", () => { if (chosen()) done(chosen()); });
    backdrop.querySelector(".modal-cancel").addEventListener("click", () => done(null));
    backdrop.querySelector(".modal-close").addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) done(null); });
    list.addEventListener("dblclick", () => { if (chosen()) done(chosen()); });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (chosen()) done(chosen()); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    });
    setTimeout(() => {
      list.focus();
      const sel = list.options[list.selectedIndex];
      if (sel) sel.scrollIntoView({ block: "nearest" });
    }, 0);
  });
}

module.exports = { promptModal, confirmModal, chooseModal };
