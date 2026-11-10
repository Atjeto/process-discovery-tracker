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

/* ---- A dialog keeps the keyboard (lane A-1) ---------------------------
   holdFocus(dialog, opts) makes `dialog` (the .modal box) one: role="dialog",
   aria-modal="true", labelled by its title (opts.title, else its first
   heading; an aria-label it already has stays). While it is open Tab and
   Shift+Tab go round inside it, first to last and back, and a focus that
   lands outside it is brought back in. It returns release(), which ends that
   and gives the focus back to the element that had it when the dialog
   opened, when that element is still in the page. The dialog's own keys and
   first focus stay its own. Dialogs opened over a dialog stack: only the top
   one holds the keyboard. */
const FOCUSABLE = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
  "video[controls]", "[tabindex]", "[contenteditable=true]",
].join(",");
const _held = [];
let _dialogSeq = 0;

/* Where Tab goes from the focusable item `index` of `count` (-1: the focus
   is not on one of them): the index to focus, or null when the browser's own
   move stays inside the dialog. Pure. */
function wrapFocusIndex(count, index, backwards) {
  if (!(count > 0)) return -1;
  if (index < 0 || index >= count) return backwards ? count - 1 : 0;
  if (backwards && index === 0) return count - 1;
  if (!backwards && index === count - 1) return 0;
  return null;
}

function _focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) =>
    !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0 &&
    !el.closest("[hidden], [inert]"));
}

function holdFocus(dialog, opts) {
  const o = opts || {};
  const opener = document.activeElement;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  if (!dialog.hasAttribute("aria-label")) {
    const title = o.title || dialog.querySelector("h1, h2, h3");
    if (title) {
      if (!title.id) title.id = "dialog-title-" + (++_dialogSeq);
      dialog.setAttribute("aria-labelledby", title.id);
    }
  }
  const entry = { dialog };
  const top = () => _held[_held.length - 1] === entry;
  const onKey = (e) => {
    if (e.key !== "Tab" || !top() || e.defaultPrevented) return;
    const items = _focusables(dialog);
    const to = wrapFocusIndex(items.length, items.indexOf(document.activeElement), e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    (to >= 0 ? items[to] : dialog).focus();
  };
  const onFocusIn = (e) => {
    if (!top() || !dialog.isConnected || dialog.contains(e.target)) return;
    (_focusables(dialog)[0] || dialog).focus();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocusIn, true);
  _held.push(entry);
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocusIn, true);
    const at = _held.indexOf(entry);
    if (at >= 0) _held.splice(at, 1);
    if (o.returnFocus === false) return;
    if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === "function") {
      try { opener.focus(); } catch (_) { /* it cannot take the focus now */ }
    }
  };
}

/* opts.list (lane B-V2, the Hand off... dialog only): { lead, items, more,
   onPick } shows, before the input, the line `lead` and under it `items`
   (strings), each a link-style button, then `more` (a last line, no link)
   when given. A click on an item closes the dialog as Cancel does (the
   promise resolves to null) and then calls onPick(index). Without
   opts.list the dialog is built exactly as before. */
function _promptListHtml(list) {
  if (!list || !Array.isArray(list.items) || !list.items.length) return "";
  return '<div class="modal-pick">' +
    (list.lead ? '<p class="modal-pick-lead">' + escapeHtml(list.lead) + "</p>" : "") +
    '<ul class="modal-pick-list">' + list.items.map((text, i) => '<li><button type="button" class="link-btn modal-pick-go" data-pick="' +
      i + '">' + escapeHtml(text) + "</button></li>").join("") +
    (list.more ? '<li class="modal-pick-more">' + escapeHtml(list.more) + "</li>" : "") + "</ul></div>";
}

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
      '<button class="icon-btn modal-close" title="Cancel (Esc)" aria-label="Close">✕</button></header>' +
      '<div class="modal-body">' +
      (opts.message ? '<p class="modal-msg">' + escapeHtml(opts.message) + '</p>' : '') +
      (opts.detail ? '<p class="modal-detail">' + escapeHtml(opts.detail) + '</p>' : '') +
      _promptListHtml(opts.list) +
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
    const releaseFocus = holdFocus(backdrop.querySelector(".modal"));
    const input = backdrop.querySelector(".modal-input");
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      releaseFocus();
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
    backdrop.querySelectorAll(".modal-pick-go").forEach((b) => {
      b.addEventListener("click", () => {
        done(null);
        if (typeof opts.list.onPick === "function") opts.list.onPick(Number(b.dataset.pick));
      });
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
      '<button class="icon-btn modal-close" title="Cancel (Esc)" aria-label="Close">✕</button></header>' +
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
    const releaseFocus = holdFocus(backdrop.querySelector(".modal"));
    const okBtn = backdrop.querySelector(".modal-ok");
    const cancelBtn = backdrop.querySelector(".modal-cancel");
    const closeBtn = backdrop.querySelector(".modal-close");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      releaseFocus();
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
      '<button class="icon-btn modal-close" title="Cancel (Esc)" aria-label="Close">✕</button></header>' +
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
    const releaseFocus = holdFocus(backdrop.querySelector(".modal"));
    const list = backdrop.querySelector(".modal-list");
    const okBtn = backdrop.querySelector(".modal-ok");
    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      backdrop.remove();
      releaseFocus();
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

module.exports = { promptModal, confirmModal, chooseModal, holdFocus, wrapFocusIndex };
