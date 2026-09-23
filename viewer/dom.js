/*
 * dom.js -- tiny DOM helpers and formatters shared across the viewer.
 *
 * Pure, dependency-free utilities: query selectors, HTML/attribute
 * escaping, duration formatting, table fill, id generation, and the
 * toast. Imported by renderer.js and the per-view modules.
 */

"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  // String(s ?? "") so null/undefined render as "" (not the literal "null") --
  // matches escapeAttr and the per-view copies this is the source of truth for.
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function formatDuration(ms) {
  if (ms == null) return "";
  const s = ms / 1000;
  if (s < 1) return Math.round(ms) + "ms";
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m" + Math.round(s % 60) + "s";
  return Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m";
}

function fillTable(sel, rows) {
  const tbody = document.querySelector(sel + " tbody");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (let i = 0; i < row.length; i++) {
      const td = document.createElement("td");
      if (typeof row[i] === "number" || /^[0-9.]+%?$/.test(String(row[i]))) td.className = "num";
      td.textContent = row[i] != null ? String(row[i]) : "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2);
}

let toastTimer = null;
/* A transient message at the bottom of the window. opts.action =
   { label, act, onClick } adds one button to it (an offer such as "Hide in all
   runs", or an Undo): the toast then stays a little longer and takes clicks
   while it shows (only then: a hidden toast never catches a click). */
function toast(text, kind, opts) {
  const el = $("#toast");
  const action = opts && opts.action;
  el.textContent = text;
  el.className = "toast show" + (kind ? " " + kind : "") + (action ? " has-action" : "");
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    if (action.act) b.dataset.act = action.act;
    b.textContent = action.label;
    b.addEventListener("click", () => {
      el.classList.remove("show");
      action.onClick();
    });
    el.appendChild(b);
  }
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), action ? 8000 : 3500);
}

/* Where a w x h context menu opened at the click point (x, y) goes so all of
   it stays inside a vw x vh window: at the click point when it fits there;
   else on the other side of the point when it fits there (upwards at the
   bottom of the window, leftwards at its right edge, the way desktop menus
   open); else as close to the point as fits. Never closer than `margin` px
   to an edge. Pure, so the unit tests pin the arithmetic. */
function fitMenuPosition(x, y, w, h, vw, vh, margin) {
  const m = margin == null ? 4 : margin;
  const axis = (p, size, room) => {
    let v = p;
    if (p + size + m > room) v = p - size >= m ? p - size : room - size - m;
    return Math.max(m, Math.min(v, room - size - m));
  };
  return { left: Math.round(axis(x, w, vw)), top: Math.round(axis(y, h, vh)) };
}

/* Show a position:fixed context menu, already in the document, at the click
   point and inside the window (L5b). Placed at the click point as is, a
   right-click near the bottom or the right edge of a small window put items
   off screen, where no scrolling reaches a fixed menu (on a 1366x768 window
   the Flow timeline shows only as a strip at the bottom edge). The menu is
   measured at the window's top left, so its size does not depend on the
   click point; a menu taller than the window scrolls. */
function placeMenu(menu, x, y) {
  const m = 4;
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = "0px";
  menu.style.top = "0px";
  if (menu.offsetHeight > vh - 2 * m) {
    menu.style.maxHeight = (vh - 2 * m) + "px";
    menu.style.overflowY = "auto";
  }
  const p = fitMenuPosition(x, y, menu.offsetWidth, menu.offsetHeight, vw, vh, m);
  menu.style.left = p.left + "px";
  menu.style.top = p.top + "px";
}

module.exports = { $, $$, escapeHtml, escapeAttr, formatDuration, fillTable, cryptoRandomId, toast,
  fitMenuPosition, placeMenu };
