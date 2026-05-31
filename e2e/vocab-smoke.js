"use strict";
/*
 * App Library (vocab editor) e2e smoke — the ADR-0025 discovery-enrichment pin.
 *
 * Successor scope to session-smoke.js, focused on the App Library editor. It
 * launches the REAL viewer pre-pointed at a TEMP vocab dir (PDT_APP_VOCABULARIES)
 * holding one freshly-"discovered" entry whose only signature is a weak
 * class_name — the exact shape that, pre-fix, rendered as a blank "(unset
 * signature)" row and was ERASED to `{}` on save. It then asserts:
 *
 *   - the row is legible, not blank: the signature summary shows the class_name,
 *     the annotator-context chips (role / region / framework) render, the
 *     ancestry + the honest weak-signature note render, and the over-merge
 *     members disclosure lists the distinct controls that collapsed together;
 *   - the chips/labels are not clipped (scrollWidth <= clientWidth);
 *   - the load-bearing fix: after Save, the on-disk YAML still carries
 *     `signature.class_name` (no longer nuked), the analyst-facing fields survive
 *     (seen_count), and the discovery-meta (role / framework / region / ancestry
 *     / _members / confidence) is stripped so the persisted vocab stays clean.
 *
 * Writes ONLY into its own temp dir; touches no committed data. Exits non-zero
 * on any regression so CI can gate on it. Reuses the viewer's Electron + js-yaml.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { _electron: electron } = require("playwright-core");

const REPO = path.resolve(__dirname, "..");
const VIEWER = path.join(REPO, "viewer");
const OUT = __dirname;
const electronPath = require(path.join(VIEWER, "node_modules", "electron"));
const yaml = require(path.join(VIEWER, "node_modules", "js-yaml"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? " OK " : "FAIL"}] ${name}` + (detail ? "  — " + detail : ""));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true })
    .catch((e) => console.log("shot fail", name, e.message));
}

// One "discovered" entry whose only signature is a weak class_name, plus the
// enrichment the picker now stamps (the post-discovery editor state). Two members
// at DISTINCT regions == the over-merge the annotator must be able to see.
const SEED = {
  app_vocabulary: {
    id: "spotify-e2e", name: "Spotify E2E", version: 1,
    scope: { window_title_regex: ".*Spotify E2E.*" },
    screens: [{ id: "spotify-e2e", name: "Spotify E2E" }],
    interactions: [
      {
        signature: { class_name: "x-btn" },
        name: "",
        identity_source: "class_name", confidence: 0.4, seen_count: 2,
        role: "button", framework: "chromium", region: "bottom-left",
        ancestry: ["Window", "Pane"],
        _members: [
          { role: "button", region: "bottom-left", under: ["Window", "Pane"] },
          { role: "button", region: "bottom-right", under: ["Window", "Pane"] },
        ],
        screen: "spotify-e2e",
      },
    ],
  },
};

(async () => {
  const vocabDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-vocab-e2e-"));
  const seedPath = path.join(vocabDir, "spotify-e2e.yaml");
  fs.writeFileSync(seedPath, yaml.dump(SEED), "utf-8");

  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ["."],
      cwd: VIEWER,
      env: Object.assign({}, process.env, { PDT_APP_VOCABULARIES: vocabDir }),
    });
  } catch (e) {
    console.error("FATAL: could not launch viewer Electron:", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await page.waitForLoadState("domcontentloaded").catch(() => {});

  // Open the App Library tab and select the seeded vocab.
  let opened = false;
  try {
    await page.waitForSelector('.tab[data-view="vocabularies"]', { state: "visible", timeout: 15000 });
    await page.click('.tab[data-view="vocabularies"]');
    await page.waitForSelector("#vocab-list .vocab-row", { state: "visible", timeout: 8000 });
    opened = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".vocab-row")];
      const r = rows.find((x) => (x.querySelector(".vocab-row-name")?.textContent || "").trim() === "Spotify E2E");
      if (r) { r.click(); return true; }
      return false;
    });
  } catch (_) { opened = false; }
  record("App Library tab opens and the seeded vocab is listed + selectable", opened,
    opened ? "" : "could not find/select the 'Spotify E2E' row");
  if (!opened) { await shot(page, "fail-vocab-open.png"); await app.close().catch(() => {}); process.exit(1); }
  await wait(1000); // editor render

  // Probe the rendered interaction row.
  const ui = await page.evaluate(() => {
    const row = document.querySelector("#vocab-interactions .vocab-int");
    if (!row) return { row: false };
    const sig = (row.querySelector(".vocab-int-sig")?.textContent || "").trim();
    const cnInput = row.querySelector('input[data-sig="class_name"]');
    const chips = [...row.querySelectorAll(".vocab-int-chip")].map((c) => (c.textContent || "").trim());
    // Clipping check (CLAUDE.md: validate label rendering): no chip/summary/note
    // may overflow its box.
    const clip = [];
    row.querySelectorAll(".vocab-int-chip, .vocab-int-sig, .vocab-int-members > summary").forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) clip.push((el.textContent || "").trim().slice(0, 24));
    });
    return {
      row: true,
      sig,
      hasClassInput: !!cnInput,
      classValue: cnInput ? cnInput.value : null,
      chips,
      hasWeakNote: !!row.querySelector(".vocab-int-weak-note"),
      hasMembers: !!row.querySelector(".vocab-int-members"),
      memberItems: row.querySelectorAll(".vocab-int-members li").length,
      clipped: clip,
    };
  }).catch((e) => ({ err: e.message }));

  if (ui.err || !ui.row) {
    record("discovered row renders", false, ui.err || "no .vocab-int row");
    await shot(page, "fail-vocab-row.png");
  } else {
    record("class_name signature is shown, not '(unset signature)'",
      ui.sig.includes("x-btn") && !/unset signature/.test(ui.sig), "summary='" + ui.sig + "'");
    record("class_name is an editable, populated field (survives the round-trip)",
      ui.hasClassInput && ui.classValue === "x-btn", "value='" + ui.classValue + "'");
    record("annotator-context chips render (role / region / framework)",
      ui.chips.includes("button") && ui.chips.includes("bottom-left") && ui.chips.includes("chromium"),
      "chips=[" + ui.chips.join(", ") + "]");
    record("honest weak-signature note renders", ui.hasWeakNote, ui.hasWeakNote ? "" : "no .vocab-int-weak-note");
    record("over-merge members disclosure lists the distinct collapsed controls",
      ui.hasMembers && ui.memberItems === 2, "memberItems=" + ui.memberItems);
    record("row labels/chips are not clipped", ui.clipped.length === 0,
      ui.clipped.length ? "clipped: " + ui.clipped.join(", ") : "all fit");
    if (results.some((r) => !r.ok)) await shot(page, "fail-vocab-render.png");
  }
  await shot(page, "vocab-enriched-row.png");

  // The load-bearing fix: Save, then the on-disk YAML must still carry class_name.
  await page.click("#btn-vocab-save").catch((e) => console.log("save", e.message));
  await wait(1200);
  let saved = null;
  try { saved = yaml.load(fs.readFileSync(seedPath, "utf-8")); } catch (e) { saved = { _err: e.message }; }
  const e0 = saved && saved.app_vocabulary && (saved.app_vocabulary.interactions || [])[0];
  record("after Save, signature.class_name SURVIVES on disk (the data-loss fix)",
    !!(e0 && e0.signature && e0.signature.class_name === "x-btn"),
    "saved signature=" + JSON.stringify(e0 && e0.signature));
  record("after Save, seen_count (analyst-facing) is preserved",
    !!(e0 && e0.seen_count === 2), "seen_count=" + (e0 && e0.seen_count));
  record("after Save, discovery-meta is stripped (clean persisted vocab)",
    !!(e0 && !("role" in e0) && !("_members" in e0) && !("confidence" in e0) && !("region" in e0)),
    "leftover keys=" + (e0 ? Object.keys(e0).filter((k) => ["role", "framework", "region", "ancestry", "_members", "confidence", "identity_source"].includes(k)).join(",") || "(none)" : "?"));

  record("zero PAGE ERRORs", pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 5).join(" | ") : "");
  if (pageErrors.length) await shot(page, "fail-vocab-page-errors.png");

  await app.close().catch(() => {});
  try { fs.rmSync(vocabDir, { recursive: true, force: true }); } catch (_) {}

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log("\n[vocab-e2e] " + pass + "/" + results.length + " checks passed, " + fail + " failed");
  if (fail) {
    console.log("[vocab-e2e] FAILURES:");
    for (const r of results) if (!r.ok) console.log("   - " + r.name + ": " + (r.detail || ""));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("[vocab-e2e] driver crash:", e && e.stack ? e.stack : e); process.exit(2); });
