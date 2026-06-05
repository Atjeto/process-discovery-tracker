"use strict";
/*
 * Accessibility smoke (WCAG 2.1 AA — landed in the a11y audit pass).
 *
 * Asserts:
 *   - Tabbing through the topbar lands on every interactive element.
 *   - The session-mode toggle is a tablist; each .mode-btn has
 *     aria-selected that matches its .active class.
 *   - The Ollama-status status pill is a <button>, not a <div>.
 *   - At least one .engagement-card is a <button> and Tab-focusable.
 *   - The engagement-demo-card is a <button>.
 *   - .confidence-pill has a ::before pseudo-element rendered.
 *   - Runtime contrast: --fg-4 text on --bg, .cockpit-conf-med text on its
 *     own background, and a sample focus-outline on its background — all
 *     three must clear the WCAG threshold (4.5:1 text, 3:1 non-text).
 *
 * Non-zero exit on any regression. Uses the bundled demo-pack engagement
 * and the demo-alice session.
 */

const path = require("path");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const SESSION = path.join(REPO, "sessions", "demo-pack", "sessions", "demo-alice-20260601-0900");
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const OUT = __dirname;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true }).catch(() => {});
}

/* ---- runtime contrast helpers, injected into the page ---- */
function contrastProbeScript() {
  // Run on the page. Returns an object { fg4OnBg, confMed, focusOutline }.
  function srgbToLin(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance(r, g, b) {
    return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  }
  function parseColor(str) {
    // Handles rgb(), rgba(), and falls back to a probe element if needed.
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map(s => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] == null ? 1 : parts[3] };
  }
  // alpha-blend rgba over an opaque background colour.
  function flatten(rgba, bg) {
    if (rgba.a >= 0.999) return rgba;
    return {
      r: rgba.r * rgba.a + bg.r * (1 - rgba.a),
      g: rgba.g * rgba.a + bg.g * (1 - rgba.a),
      b: rgba.b * rgba.a + bg.b * (1 - rgba.a),
      a: 1,
    };
  }
  function ratio(c1, c2) {
    const L1 = luminance(c1.r, c1.g, c1.b);
    const L2 = luminance(c2.r, c2.g, c2.b);
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function tokenColor(token) {
    // Stash the token's value via a probe element so we get the resolved colour.
    const probe = document.createElement("div");
    probe.style.color = "var(" + token + ")";
    probe.style.display = "none";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return parseColor(c);
  }

  const bg = tokenColor("--bg");
  const fg4 = tokenColor("--fg-4");
  const fg4OnBg = ratio(fg4, bg);

  // .cockpit-conf-med — probe one if present, else build a synthetic one.
  let confMed = null;
  let confSrc = "synthetic";
  let existing = document.querySelector(".cockpit-conf-med, .confidence-pill.conf-med");
  let probe;
  if (existing) {
    probe = existing;
    confSrc = "live-dom";
  } else {
    probe = document.createElement("span");
    probe.className = "confidence-pill conf-med cockpit-conf-med";
    probe.textContent = "50%";
    document.body.appendChild(probe);
  }
  try {
    const cs = getComputedStyle(probe);
    const fg = parseColor(cs.color);
    let bgRaw = parseColor(cs.backgroundColor);
    if (!bgRaw || bgRaw.a === 0) bgRaw = bg;
    const bgFlat = flatten(bgRaw, bg);
    confMed = { ratio: ratio(fg, bgFlat), src: confSrc, color: cs.color, bg: cs.backgroundColor };
  } finally {
    if (confSrc === "synthetic") probe.remove();
  }

  // Focus outline: the universal :focus-visible rule uses --accent-hover
  // (darker than --accent) so the ring clears 3:1 with real headroom on cream.
  const accentHover = tokenColor("--accent-hover");
  const focusOutline = { ratio: ratio(accentHover, bg), color: "var(--accent-hover)" };

  return { fg4OnBg, confMed, focusOutline };
}

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [".", "--session=" + SESSION],
      cwd: VIEWER,
      env: Object.assign({}, process.env, { PDT_OLLAMA_URL: "http://127.0.0.1:11434" }),
    });
  } catch (e) {
    console.error("FATAL: viewer launch:", e.message);
    process.exit(2);
  }
  const page = await app.firstWindow();
  const pageErrs = [];
  page.on("pageerror", (e) => pageErrs.push(String(e.message)));

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.evaluate(() => { try { localStorage.removeItem("pdt.sessionMode"); } catch (_) {} });
  let loaded = false;
  try {
    await page.waitForSelector("#session-loaded", { state: "visible", timeout: 20000 });
    loaded = true;
  } catch (_) {}
  record("session loaded", loaded);
  if (!loaded) { await shot(page, "a11y-fail-no-load.png"); await app.close(); process.exit(1); }
  await wait(1500);

  // 1. Ollama-status is now a <button>.
  const ollamaTag = await page.evaluate(() =>
    document.getElementById("ollama-status")?.tagName);
  record("ollama-status is a <button>", ollamaTag === "BUTTON", "tag=" + ollamaTag);

  // 2. Mode toggle has role=tablist and aria-selected mirrors .active.
  const tablistInfo = await page.evaluate(() => {
    const wrap = document.getElementById("session-mode-toggle");
    if (!wrap) return null;
    const role = wrap.getAttribute("role");
    const buttons = Array.from(wrap.querySelectorAll(".mode-btn")).map(b => ({
      mode: b.dataset.mode,
      role: b.getAttribute("role"),
      active: b.classList.contains("active"),
      ariaSelected: b.getAttribute("aria-selected"),
    }));
    return { role, buttons };
  });
  record("session-mode-toggle has role=tablist",
    tablistInfo && tablistInfo.role === "tablist", JSON.stringify(tablistInfo));
  const tabsAllOk = tablistInfo && tablistInfo.buttons.every(b =>
    b.role === "tab" && ((b.active && b.ariaSelected === "true") || (!b.active && b.ariaSelected === "false")));
  record("each mode-btn has role=tab + aria-selected mirrors .active",
    tabsAllOk, JSON.stringify(tablistInfo));

  // 3. Confidence-pill ::before renders (the WCAG 1.4.1 colour-only fix).
  const pillBefore = await page.evaluate(() => {
    let el = document.querySelector(".confidence-pill");
    let synthetic = false;
    if (!el) {
      el = document.createElement("span");
      el.className = "confidence-pill conf-high";
      el.textContent = "80%";
      document.body.appendChild(el);
      synthetic = true;
    }
    const cs = getComputedStyle(el, "::before");
    const result = {
      content: cs.content,
      width: cs.width,
      height: cs.height,
      synthetic,
    };
    if (synthetic) el.remove();
    return result;
  });
  record("confidence-pill has ::before pseudo (shape glyph)",
    pillBefore.content && pillBefore.content !== "none" && pillBefore.width !== "auto",
    JSON.stringify(pillBefore));

  // 4. Tabbing through the topbar. Click brand to start, then Tab repeatedly
  //    and record activeElement after each press.
  await page.evaluate(() => {
    // Move focus to the body so the first Tab lands on the first focusable.
    document.body.focus();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  const tabbedIds = [];
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    const ae = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      return {
        tag: e.tagName,
        id: e.id || null,
        cls: (e.className && typeof e.className === "string") ? e.className.split(/\s+/).slice(0, 2).join(" ") : null,
        ariaLabel: e.getAttribute("aria-label") || null,
        inTopbar: !!e.closest(".topbar"),
      };
    });
    if (ae) tabbedIds.push(ae);
  }
  // We expect at least: each session tab, each mode-btn, ollama-status, recent
  // menu trigger, project menu trigger, theme toggle, help button. Some
  // surfaces consume focus rings via :focus-visible only — tab order itself
  // is the assertion, not whether the ring is visible.
  const topbarHits = tabbedIds.filter(e => e.inTopbar);
  const hitOllama = topbarHits.some(e => e.id === "ollama-status");
  const hitModeBtn = topbarHits.some(e => e.cls && e.cls.split(" ").includes("mode-btn"));
  const hitTheme = topbarHits.some(e => e.id === "btn-theme-toggle");
  const hitHelp = topbarHits.some(e => e.id === "btn-help");
  const hitRecent = topbarHits.some(e => e.id === "btn-recent-menu");
  const hitProject = topbarHits.some(e => e.id === "btn-project-menu");
  record("Tab order reaches ollama-status button", hitOllama, "topbar hits=" + JSON.stringify(topbarHits));
  record("Tab order reaches at least one mode-btn", hitModeBtn);
  record("Tab order reaches Recent menu", hitRecent);
  record("Tab order reaches Project menu", hitProject);
  record("Tab order reaches theme toggle", hitTheme);
  record("Tab order reaches help button", hitHelp);

  // 5. Engagement cards are <button>. We need engagement view. Switch tab.
  await page.evaluate(() => document.querySelector('.tab[data-view="engagement"]').click());
  await wait(1200);
  // Empty state — show demo card section.
  const demoCardTag = await page.evaluate(() => {
    const el = document.querySelector(".engagement-demo-card");
    return el ? el.tagName : null;
  });
  record("engagement-demo-card is a <button>", demoCardTag === "BUTTON", "tag=" + demoCardTag);

  // Open the demo engagement so backlog cards render.
  const demoOpened = await page.evaluate(async () => {
    const card = document.querySelector(".engagement-demo-card");
    if (!card) return false;
    card.click();
    return true;
  });
  if (demoOpened) {
    // Wait for the backlog to render. Loosely: poll for a card or 7 s.
    for (let i = 0; i < 40; i++) {
      const ready = await page.evaluate(() =>
        !!document.querySelector(".engagement-card"));
      if (ready) break;
      await wait(200);
    }
    const cardInfo = await page.evaluate(() => {
      const el = document.querySelector(".engagement-card");
      if (!el) return null;
      return { tag: el.tagName, type: el.getAttribute("type") };
    });
    record("engagement-card is a <button>",
      cardInfo && cardInfo.tag === "BUTTON" && cardInfo.type === "button",
      JSON.stringify(cardInfo));

    // Tab into the engagement view from the body and confirm a card is reachable.
    await page.evaluate(() => {
      document.activeElement && document.activeElement.blur();
      const c = document.querySelector(".engagement-card");
      if (c) c.focus();
    });
    const focused = await page.evaluate(() => {
      const e = document.activeElement;
      return e && e.classList.contains("engagement-card");
    });
    record("engagement-card is focusable", focused);
  } else {
    record("engagement-card is a <button>", false, "demo card not opened");
  }

  // 6. Runtime contrast probe.
  const contrast = await page.evaluate(contrastProbeScript);
  record("contrast --fg-4 on --bg ≥ 4.5:1",
    contrast.fg4OnBg >= 4.5,
    "ratio=" + (contrast.fg4OnBg != null ? contrast.fg4OnBg.toFixed(2) : "n/a"));
  record("contrast .cockpit-conf-med text on its bg ≥ 4.5:1",
    contrast.confMed && contrast.confMed.ratio >= 4.5,
    contrast.confMed
      ? ("ratio=" + contrast.confMed.ratio.toFixed(2) + " src=" + contrast.confMed.src +
         " color=" + contrast.confMed.color + " bg=" + contrast.confMed.bg)
      : "n/a");
  record("contrast focus outline (--accent-hover) on --bg ≥ 3:1",
    contrast.focusOutline && contrast.focusOutline.ratio >= 3,
    "ratio=" + (contrast.focusOutline && contrast.focusOutline.ratio != null
      ? contrast.focusOutline.ratio.toFixed(2) : "n/a"));

  await shot(page, "a11y-smoke-final.png");
  record("zero PAGE ERRORs", pageErrs.length === 0, pageErrs.slice(0, 3).join(" | "));

  await app.close().catch(() => {});
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n[a11y-smoke] ${results.length - fail}/${results.length} passed, ${fail} failed`);
  if (fail) for (const r of results) if (!r.ok) console.log("  - " + r.name + ": " + (r.detail || ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[a11y-smoke] crash:", e.stack); process.exit(2); });
