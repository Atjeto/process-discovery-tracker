/*
 * command-palette.js
 * Ctrl+K global quick-search across cases, steps, markers, and
 * top-level commands.
 *
 * Self-contained: builds its own DOM lazily on first open, owns the
 * keyboard handlers, exposes a registerProvider(key, fn) hook each view
 * uses to feed it items. Provider signature:
 *   fn(query: string) -> Array<{ type, label, hint?, run() }>
 * Each provider does its own filtering; the palette concatenates every
 * registered provider's results and renders + drives the list.
 */

"use strict";

(function () {
  let overlay = null, input = null, list = null;
  const providers = new Map();   // key -> fn(query) -> items[]
  let items = [];
  let selectedIndex = 0;
  let inputDebounce = null;

  function ensureDOM() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "cmdpalette-overlay";
    overlay.innerHTML = `
      <div class="cmdpalette" role="dialog" aria-label="Command palette">
        <div class="cmdpalette-input-wrap">
          <input id="cmdpalette-input" type="text" autocomplete="off" spellcheck="false"
                 placeholder="Jump to a step, marker, case, or command..." />
          <span class="cmdpalette-kbd">Esc</span>
        </div>
        <div id="cmdpalette-list" class="cmdpalette-list"></div>
        <div class="cmdpalette-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    input = overlay.querySelector("#cmdpalette-input");
    list = overlay.querySelector("#cmdpalette-list");

    input.addEventListener("input", () => {
      clearTimeout(inputDebounce);
      inputDebounce = setTimeout(() => render(input.value), 50);
    });
  }

  function move(delta) {
    if (!items.length) return;
    selectedIndex = (selectedIndex + delta + items.length) % items.length;
    highlight();
    const sel = list.querySelector(".cmdpalette-row.selected");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }

  /* Repaint only the selection marker. Hover and arrow-key nav use this
     instead of paint(): paint() rebuilds the whole list, and rebuilding
     it under the cursor swaps the row out between mousedown and mouseup,
     so the browser never fires a click on the row. */
  function highlight() {
    if (!list) return;
    list.querySelectorAll(".cmdpalette-row").forEach((row, i) => {
      row.classList.toggle("selected", i === selectedIndex);
    });
  }

  function fire() {
    if (!items.length) return;
    if (selectedIndex < 0 || selectedIndex >= items.length) selectedIndex = 0;
    const item = items[selectedIndex];
    if (!item) return;
    close();
    try { item.run(); } catch (e) { console.error("palette action failed", e); }
  }

  function render(query) {
    const q = query || "";
    let collected = [];
    for (const fn of providers.values()) {
      try {
        const part = fn(q);
        if (Array.isArray(part)) collected = collected.concat(part);
      } catch (e) {
        console.error("palette provider failed", e);
      }
    }
    items = collected;
    selectedIndex = 0;
    paint();
  }

  function paint() {
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<div class="cmdpalette-empty">No matches.</div>`;
      return;
    }
    const rows = items.map((it, i) => {
      const sel = i === selectedIndex ? " selected" : "";
      const hint = it.hint ? `<span class="cmdpalette-hint">${escapeHtml(it.hint)}</span>` : "";
      return `<div class="cmdpalette-row${sel}" data-idx="${i}">
        <span class="cmdpalette-type cmdpalette-type-${escapeAttr(it.type)}">${escapeHtml(typeBadge(it.type))}</span>
        <span class="cmdpalette-label">${escapeHtml(it.label)}</span>
        ${hint}
      </div>`;
    }).join("");
    list.innerHTML = rows;
    list.querySelectorAll(".cmdpalette-row").forEach(row => {
      row.addEventListener("click", () => {
        selectedIndex = parseInt(row.dataset.idx, 10);
        fire();
      });
      row.addEventListener("mouseenter", () => {
        selectedIndex = parseInt(row.dataset.idx, 10);
        highlight();
      });
    });
  }

  function typeBadge(type) {
    return {
      step:    "STEP",
      marker:  "MARK",
      case:    "CASE",
      command: "CMD",
      session: "SESS",
    }[type] || "•";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function open() {
    ensureDOM();
    overlay.classList.add("open");
    input.value = "";
    render("");
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("open");
  }

  function toggle() {
    if (overlay && overlay.classList.contains("open")) close();
    else open();
  }

  // Global hotkey: Ctrl+K (Cmd+K on Mac, though we ship Win-only).
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      // Don't hijack if focus is in a contenteditable or specific text
      // input that has its own Ctrl+K binding (we don't, but be safe).
      e.preventDefault();
      toggle();
    }
  });

  /* Palette keyboard navigation. Bound at the document level (not on the
     search input) so Arrow/Enter/Esc/Tab work whenever the palette is
     open, regardless of which element currently holds focus. */
  document.addEventListener("keydown", (e) => {
    if (!overlay || !overlay.classList.contains("open")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); fire(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
  });

  module.exports = {
    open, close, toggle,
    /* Each view registers its commands under a stable key; re-registering
       the same key replaces that view's provider. */
    registerProvider: (key, fn) => {
      if (key && typeof fn === "function") providers.set(key, fn);
    },
    /* Back-compat alias for the original single-provider hook. */
    setProvider: (fn) => { providers.set("default", fn); },
  };
})();
