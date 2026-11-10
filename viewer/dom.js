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

/* One clock (AD-26): a moment is shown as the time since the recording
   started, "0:19", "12:05", "1:02:03" (the PDD's pointers, step_context.clock);
   a moment before the start reads "-0:30". The timeline, the markers, the
   screenshots, the transcript, the step pane and the step panel all use it;
   the time of day shows only with the recording's date. "" when the value
   cannot be read. */
function clock(ms) {
  if (typeof ms !== "number" || !isFinite(ms)) return "";
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return (ms < 0 && total > 0 ? "-" : "") + (h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s));
}

/* When the recording started, in ms: manifest.started_at, else its first
   event. NaN when neither can be read. */
function recordingStartMs(sess) {
  const started = Date.parse(sess && sess.manifest && sess.manifest.started_at);
  if (isFinite(started)) return started;
  const evs = (sess && sess.events) || [];
  return evs.length ? Date.parse(evs[0].timestamp) : NaN;
}

/* The time since the recording started of an ISO moment ("" when unknown). */
function sinceStart(iso, originMs) {
  const t = Date.parse(iso);
  return isFinite(t) && isFinite(originMs) ? clock(t - originMs) : "";
}

/* A typed position ("1:05", "0:07", "1:02:03") in ms, or null. */
function parseClock(text) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(String(text || ""));
  if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) return null;
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

/* A duration the one way the app and the step map's documentation say it
   (2.0.1; the pipeline's step_context.fmt_ms): "under 1s", "42s", "2m 07s", "3m", "1h 04m"; never
   "0s", "28.9s" or "414ms", and never "2:17", which reads as a moment on
   the one clock. "" when unknown. */
function formatDuration(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "under 1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? m + "m " + String(rs).padStart(2, "0") + "s" : m + "m";
  const h = Math.floor(m / 60), rm = m % 60;
  return h + "h " + String(rm).padStart(2, "0") + "m";
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

/* How long a message shows (lane A-1). An error stays (null) until the
   person dismisses it (its Dismiss, or Escape while no dialog or menu is
   open), a newer message replaces it, or their next click or key press
   outside it once it has been up TOAST_MS (toastClosesOnInteraction). An
   ordinary or success message goes after TOAST_MS, TOAST_LONG_MS with an
   action or a hold. Pure. */
const TOAST_MS = 3500;
const TOAST_LONG_MS = 8000;
function toastLifetime(kind, opts) {
  if (kind === "error") return null;
  return opts && (opts.action || opts.hold) ? TOAST_LONG_MS : TOAST_MS;
}
function toastClosesOnInteraction(shownAt, now) {
  return now - shownAt >= TOAST_MS;
}

let toastTimer = null;
let toastFillTimer = null;
let toastHeldUntil = 0;
let toastShownAt = 0;
let toastSticky = false;
let toastWired = false;

function hideToast() {
  const el = $("#toast");
  toastSticky = false;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (el) el.classList.remove("show");
}

/* A dialog or a menu is open: Escape is theirs, not the message's. */
function _overlayOpen() {
  const shown = (el) => !!el && el.getClientRects().length > 0;
  return [...document.querySelectorAll('.modal-backdrop, [aria-modal="true"], .project-menu-popup, .lanes-popup, #refmap-editor-overlay')]
    .some(shown);
}

function _wireToast() {
  if (toastWired || typeof document.addEventListener !== "function") return;
  toastWired = true;
  const outside = (e) => {
    const el = $("#toast");
    return !(el && e.target && typeof el.contains === "function" && el.contains(e.target));
  };
  document.addEventListener("keydown", (e) => {
    if (!toastSticky) return;
    if (e.key === "Escape") {
      // Not consumed: the page's own Escape (a context menu, the selection)
      // still runs.
      if (!e.defaultPrevented && !_overlayOpen()) hideToast();
      return;
    }
    if (outside(e) && toastClosesOnInteraction(toastShownAt, Date.now())) hideToast();
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (toastSticky && outside(e) && toastClosesOnInteraction(toastShownAt, Date.now())) hideToast();
  }, true);
}

/* A message at the bottom of the window, announced: #toast is a polite live
   region (role="status") and an error an assertive one (role="alert"); the
   same text twice in a row is announced twice. opts.action =
   { label, act, onClick } adds one button to it (an offer such as "Hide in all
   runs", or an Undo): the toast then stays a little longer. A message never
   blocks the page: only its own buttons take clicks, and only while it shows.
   opts.hold (an error the analyst must read, such as a save that moved no
   file): no message but another error replaces it for TOAST_LONG_MS, so the
   success message of the same act does not cover it. An error carries a
   Dismiss and stays (toastLifetime). */
function toast(text, kind, opts) {
  if (kind !== "error" && Date.now() < toastHeldUntil) return;
  const el = $("#toast");
  const action = opts && opts.action;
  const error = kind === "error";
  if (toastFillTimer) { clearTimeout(toastFillTimer); toastFillTimer = null; }
  // A live region announces a change: the same text again while it shows is
  // cleared first and written a moment later.
  const again = /\bshow\b/.test(el.className) && !!el.firstChild && el.firstChild.nodeValue === String(text);
  if (typeof el.setAttribute === "function") {
    el.setAttribute("role", error ? "alert" : "status");
    el.setAttribute("aria-live", error ? "assertive" : "polite");
  }
  const fill = () => {
    toastFillTimer = null;
    el.textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "toast-action";
      if (action.act) b.dataset.act = action.act;
      b.textContent = action.label;
      b.addEventListener("click", () => {
        hideToast();
        action.onClick();
      });
      el.appendChild(b);
    }
    if (error) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "toast-close";
      x.title = "Dismiss";
      if (typeof x.setAttribute === "function") x.setAttribute("aria-label", "Dismiss");
      x.addEventListener("click", hideToast);
      el.appendChild(x);
    }
  };
  if (again) { el.textContent = ""; toastFillTimer = setTimeout(fill, 60); } else fill();
  el.className = "toast show" + (kind ? " " + kind : "") + (action ? " has-action" : "");
  const hold = !!(opts && opts.hold);
  toastHeldUntil = hold ? Date.now() + TOAST_LONG_MS : 0;
  toastShownAt = Date.now();
  toastSticky = error;
  _wireToast();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  const life = toastLifetime(kind, opts);
  if (life != null) toastTimer = setTimeout(hideToast, life);
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

module.exports = { $, $$, escapeHtml, escapeAttr, formatDuration, clock, recordingStartMs, sinceStart, parseClock,
  fillTable, cryptoRandomId, toast, hideToast, toastLifetime, toastClosesOnInteraction, fitMenuPosition, placeMenu };
